import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { ChatGroq } from "@langchain/groq"
import { ChatOpenRouter } from "@langchain/openrouter"
import dotenv from "dotenv"
import { AIMessage } from "@langchain/core/messages"

dotenv.config()

const DEFAULT_PROVIDER_ORDER = ["gemini", "groq", "openrouter"]
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000
const TRANSIENT_COOLDOWN_MS = 30 * 1000
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000
const MISCONFIGURED_COOLDOWN_MS = 365 * 24 * 60 * 60 * 1000
let invocationNumber = 0
const providerHealth = new Map()

const providerOrder = () => {
    const configured = (process.env.AI_PROVIDER_ORDER || DEFAULT_PROVIDER_ORDER.join(","))
        .split(",")
        .map((provider) => provider.trim().toLowerCase())
        .filter(Boolean)

    return [...new Set(configured)]
}

const providerKey = (provider) => ({
    gemini: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
    groq: process.env.GROQ_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY
}[provider])

const providerModelName = (provider) => ({
    gemini: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    groq: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    openrouter: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini"
}[provider])

const getProviderHealthState = (provider) => {
    const current = providerHealth.get(provider)
    if (current) {
        return current
    }

    const initial = { cooldownUntil: 0, reason: null }
    providerHealth.set(provider, initial)
    return initial
}

const createProvider = (provider, apiKey) => {
    const model = providerModelName(provider)
    const common = { apiKey, temperature: 0 }

    if (provider === "gemini") {
        return new ChatGoogleGenerativeAI({ ...common, model })
    }

    if (provider === "groq") {
        return new ChatGroq({ ...common, model })
    }

    if (provider === "openrouter") {
        return new ChatOpenRouter({
            ...common,
            model,
            maxTokens: 1800
        })
    }

    throw new Error(`Unsupported AI provider: ${provider}`)
}

const errorText = (error) => [
    error?.message,
    error?.code,
    error?.status,
    error?.response?.status,
    error?.response?.data?.error?.message
].filter(Boolean).join(" ").toLowerCase()

const errorStatus = (error) => Number(
    error?.status ||
    error?.statusCode ||
    error?.response?.status ||
    error?.cause?.status ||
    0
)


export const classifyProviderError = (error) => {
    const text = errorText(error)
    const status = errorStatus(error)

    // 1. Context/token limits must never trigger a daily quota cooldown.
    if (
        /context length|context window|maximum input tokens|max(?:imum)? tokens|prompt is too long|token limit/.test(text)
    ) {
        return {
            retryable: false,
            reason: "context_length_exceeded",
            cooldownMs: 0
        }
    }

    // 2. Explicit daily quota exhaustion.
    // Keep this specific; do not match generic "exceeded" or "billing".
    if (
        /daily quota|quota exhausted|quota exceeded|resource_exhausted|daily request limit|requests per day|per-day quota|free tier.*quota|quota.*free tier/.test(text)
    ) {
        return {
            retryable: true,
            reason: "quota_exhausted",
            cooldownMs: DAILY_COOLDOWN_MS
        }
    }

    // 3. Rate limits: short cooldown, not daily quota cooldown.
    if (
        status === 429 ||
        /rate.?limit|too many requests|requests per minute|requests per second|rate limit exceeded/.test(text)
    ) {
        return {
            retryable: true,
            reason: "rate_limit",
            cooldownMs: RATE_LIMIT_COOLDOWN_MS
        }
    }

    // 4. Invalid credentials.
    // 4. Invalid credentials.
    if (
        status === 401 ||
        /invalid api key|api[_ ]key[_ ]invalid|api key not valid|key not valid|authentication failed|unauthorized|invalid credentials/.test(text)
    ) {
        return {
            retryable: true,
            reason: "misconfigured_credentials",
            cooldownMs: MISCONFIGURED_COOLDOWN_MS
        }
    }

    // 5. Permission and model-access configuration errors.
    if (
        status === 403 ||
        /permission denied|access denied|forbidden|model access not enabled|not authorized to use model/.test(text)
    ) {
        return {
            retryable: true,
            reason: "permission_configuration",
            cooldownMs: MISCONFIGURED_COOLDOWN_MS
        }
    }

    // 6. Invalid requests and schema errors.
    if (
        [400, 404, 422].includes(status) ||
        /invalid (prompt|request|tool|schema)|malformed request|validation error|unsupported model|invalid model|programming error|developer error/.test(text)
    ) {
        return {
            retryable: false,
            reason: "non_retryable_error",
            cooldownMs: 0
        }
    }

    // 7. Temporary provider or network failures.
    if (
        [408, 425, 500, 502, 503, 504].includes(status) ||
        /timeout|temporarily unavailable|service unavailable|network|fetch failed|econn|socket/.test(text)
    ) {
        return {
            retryable: true,
            reason: "provider_unavailable",
            cooldownMs: TRANSIENT_COOLDOWN_MS
        }
    }

    // 8. Unknown errors: do not assume quota exhaustion.
    return {
        retryable: false,
        reason: "non_retryable_error",
        cooldownMs: 0
    }
}


const usageFor = (response) => {
    const usage = response?.usage_metadata || response?.response_metadata?.tokenUsage || {}
    return {
        input: usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount,
        output: usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount,
        total: usage.total_tokens ?? usage.totalTokenCount
    }
}
const normalizeMessagesForGroq = (messages) => {
    return messages.map((message) => {
        if (!AIMessage.isInstance(message)) {
            return message
        }

        const content = typeof message.content === "string"
            ? message.content
            : Array.isArray(message.content)
                ? message.content
                    .filter((block) => block?.type === "text")
                    .map((block) => block.text || "")
                    .join("\n")
                : ""

        return new AIMessage({
            content,
            tool_calls: message.tool_calls || [],
            invalid_tool_calls: message.invalid_tool_calls || [],
            id: message.id,
            name: message.name
        })
    })
}
export const createFallbackModel = (tools) => {
    const providers = providerOrder()
        .filter((provider) => providerKey(provider))
        .map((provider) => ({
            name: provider,
            model: createProvider(provider, providerKey(provider)),
            boundModel: null
        }))

    if (!providers.length) {
        throw new Error(
            "No AI provider is configured. Set GOOGLE_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY."
        )
    }

    for (const provider of providers) {
        provider.boundModel = provider.model.bindTools(tools)
    }

    const metrics = {
        invocations: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        toolCalls: 0,
        fallbacks: 0,
        errors: 0
    }

    const invoke = async (messages) => {
        const attempted = []
        let lastError

        for (const provider of providers) {
            const health = getProviderHealthState(provider.name)
            if (health.cooldownUntil > Date.now()) {
                continue
            }

            const currentInvocation = ++invocationNumber
            const startedAt = Date.now()
            metrics.invocations += 1

            try {
                if (provider.name === "groq") {
                    console.log(
                        "[ai] Groq message compatibility:",
                        JSON.stringify(
                            messages.map((message, index) => ({
                                index,
                                type: message.getType?.(),
                                contentType: typeof message.content,
                                contentBlocks: Array.isArray(message.content)
                                    ? message.content.map((block) =>
                                        typeof block === "string"
                                            ? "string"
                                            : block?.type || typeof block
                                    )
                                    : undefined,
                                toolCalls: message.tool_calls?.map(({ id, name }) => ({
                                    id,
                                    name
                                })),
                                toolCallId: message.tool_call_id
                            }))
                        )
                    )
                }
                const providerMessages = provider.name === "groq"
                    ? normalizeMessagesForGroq(messages)
                    : messages

                const response = await provider.boundModel.invoke(providerMessages)
                const usage = usageFor(response)
                const toolCallCount = Array.isArray(response?.tool_calls)
                    ? response.tool_calls.length
                    : 0

                metrics.inputTokens += usage.input || 0
                metrics.outputTokens += usage.output || 0
                metrics.totalTokens += usage.total || 0
                metrics.toolCalls += toolCallCount

                console.log("[ai] model invocation", JSON.stringify({
                    provider: provider.name,
                    model: providerModelName(provider.name),
                    invocation: currentInvocation,
                    inputTokens: usage.input ?? null,
                    outputTokens: usage.output ?? null,
                    totalTokens: usage.total ?? null,
                    toolCalls: toolCallCount,
                    durationMs: Date.now() - startedAt,
                    fallbackReason: attempted.at(-1)?.reason || null
                }))

                return response
            } catch (error) {
                const classification = classifyProviderError(error)
                lastError = error
                attempted.push({ provider: provider.name, reason: classification.reason })
                metrics.errors += 1

                if (!classification.retryable) {
                    console.error("[ai] provider invocation failed", JSON.stringify({
                        provider: provider.name,
                        model: providerModelName(provider.name),
                        invocation: currentInvocation,
                        durationMs: Date.now() - startedAt,
                        errorCategory: classification.reason,
                        fallback: false,
                        error: error?.message || String(error)
                    }))
                    throw error
                }

                const currentHealth = getProviderHealthState(provider.name)
                currentHealth.reason = classification.reason
                currentHealth.cooldownUntil = Math.max(
                    currentHealth.cooldownUntil,
                    Date.now() + classification.cooldownMs
                )
                metrics.fallbacks += 1
                console.error("[ai] provider failed; trying next configured provider", JSON.stringify({
                    provider: provider.name,
                    model: providerModelName(provider.name),
                    invocation: currentInvocation,
                    durationMs: Date.now() - startedAt,
                    errorCategory: classification.reason,
                    fallback: true,
                    error: error?.message || String(error)
                }))
            }
        }

        const unavailable = providers
            .filter((provider) => getProviderHealthState(provider.name).cooldownUntil > Date.now())
            .map((provider) => provider.name)

        const exhaustedError = lastError || new Error(
            `All configured AI providers are unavailable: ${unavailable.join(", ")}`
        )
        console.error("[ai] generation failed", JSON.stringify({
            providersUnavailable: unavailable,
            error: exhaustedError.message
        }))
        throw exhaustedError
    }

    return {
        invoke,
        getUsageSummary: () => ({ ...metrics })
    }
}

export const getProviderHealth = () => Object.fromEntries(
    [...providerHealth.entries()].map(([provider, health]) => [
        provider,
        { ...health }
    ])
)
