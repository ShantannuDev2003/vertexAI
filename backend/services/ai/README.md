# AI Service configuration

The service keeps one LangGraph agent and supports tool calling through these
providers, in order:

1. Gemini (`GOOGLE_API_KEY`, model `GEMINI_MODEL`, default `gemini-2.5-flash`)
2. Groq (`GROQ_API_KEY`, model `GROQ_MODEL`, default `llama-3.3-70b-versatile`)
3. OpenRouter (`OPENROUTER_API_KEY`, model `OPENROUTER_MODEL`, default `openai/gpt-4o-mini`)

Use `AI_PROVIDER_ORDER=gemini,groq,openrouter` to override the order. Providers
without a key are not attempted. A quota, rate-limit, authentication, service
unavailable, or transient network error cools down that provider and retries the
same agent invocation with the next configured provider. Non-retryable prompt,
schema, and programming errors are returned immediately.

Fallback happens inside the model invocation. The existing graph state and
successful filesystem tool results are not replayed.

Provider cooldowns are process-memory state shared by all graph instances in
this service process. They reset when the service restarts and are not shared
between multiple service instances.

The installed LangGraph `ToolNode` executes multiple tool calls from one AI
message concurrently. The agent is instructed to batch only independent
operations; dependent operations such as creating a folder and then using its
new ID remain separate graph rounds.
