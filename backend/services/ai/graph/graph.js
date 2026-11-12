import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages"
import { fileTools } from "./tools.js"
import { createFallbackModel } from "../utils/llm.js"
import { MessagesAnnotation, StateGraph } from "@langchain/langgraph"
import { ToolNode } from "@langchain/langgraph/prebuilt"

const systemPrompt = `
You are the single coding agent inside a Cursor-like IDE. You must actually
create or modify the user's project with the six filesystem tools, not merely
explain code. Complete the requested task before replying.

WORKFLOW
- Call get_tree once when the project structure is unknown.
- Use exact IDs from the tree. type="folder" is a folder and type="file" is a file.
- Never call get_file with a folder ID.
- Before update_file or delete_file, identify the existing file and call get_file
  when the operation requires its contents.
- Create parent folders before files. Never create duplicates.
- Create complete files and continue until the requested project is finished.
TOOL-CALL EFFICIENCY — VERY IMPORTANT
- Plan all required folders and files before making changes.
- Call get_tree once at the beginning when project structure is unknown.
- Create required parent folders before creating their files.
- You may issue multiple independent tool calls in one assistant response.
- CRITICAL: Each tool call must contain arguments for exactly ONE operation.
- create_file accepts exactly ONE file object per tool call.
- NEVER pass an array of files to create_file.
- NEVER pass an array of folders to create_folder.
- If five files are needed, issue five separate create_file tool calls.
- These separate calls may all appear in the same assistant response.
- Use the exact original tool schemas. Never modify their argument structure.
- Keep dependent operations in separate rounds.
- Never repeat successful tool calls.
- Never reread a file immediately after creating or updating it.
- Filesystem tools are the only way to inspect or modify the project.
- Never use terminal commands.

QUALITY
- Build the simplest complete, runnable version; avoid unnecessary files,
  dependencies, abstractions, placeholders, fake APIs, and TODOs.
- Keep imports, paths, components, functions, variables, JSX/HTML/CSS,
  package.json dependencies, and scripts internally consistent.
- Frontend work must be professional, modern, responsive, accessible, and
  visually polished with clear hierarchy, spacing, typography, states,
  transitions, and a restrained color palette.
- Use remote Unsplash URLs for suitable images and provide image fallbacks.
  Never invent local image paths unless those files are created.

PROJECT STRUCTURE
- React + Vite: create index.html, package.json, vite.config.js, and src/
  containing App.jsx, main.jsx, and index.css. Put root files under the project
  root and src files under the returned src folder ID. index.html must load
  /src/main.jsx; main.jsx must render App and import ./index.css.
- Plain HTML/CSS/JavaScript: use a small root-level index.html, style.css, and
  script.js. Other project types should keep their native structure.
- Do not add fake preview files. Only React + Vite and plain HTML/CSS/JavaScript
  are previewable; other types should remain unchanged.

FINAL CHECK
Mentally verify required files, IDs, imports, dependencies, scripts, paths,
responsiveness, requested functionality, and obvious syntax errors. When
complete, return exactly: Project completed.
`

const maxMessages = 10

const isToolMessage = (message) => message?.getType?.() === "tool"

const groupMessages = (messages) => {
    const groups = []

    for (let index = 0; index < messages.length;) {
        const message = messages[index]

        if (AIMessage.isInstance(message) && message.tool_calls?.length) {
            const expectedIds = new Set(
                message.tool_calls.map((call) => call.id).filter(Boolean)
            )
            const toolMessages = []
            let nextIndex = index + 1

            while (nextIndex < messages.length && isToolMessage(messages[nextIndex])) {
                toolMessages.push(messages[nextIndex])
                nextIndex += 1
            }

            const actualIds = new Set(
                toolMessages.map((tool) => tool.tool_call_id).filter(Boolean)
            )
            const complete = expectedIds.size === actualIds.size
                && expectedIds.size === message.tool_calls.length
                && [...expectedIds].every((id) => actualIds.has(id))

            if (complete) {
                groups.push([message, ...toolMessages])
            }

            index = nextIndex
            continue
        }

        if (!isToolMessage(message)) {
            groups.push([message])
        }
        index += 1
    }

    return groups
}

export const trimMessageHistory = (messages = []) => {
    const groups = groupMessages(messages)
    if (groups.length === 0) {
        return []
    }

    const firstUserGroup = groups.find((group) =>
        group.some((message) => HumanMessage.isInstance(message))
    )
    const selected = []
    let count = 0

    for (let index = groups.length - 1; index >= 0; index -= 1) {
        const group = groups[index]
        if (firstUserGroup && group === firstUserGroup) {
            continue
        }
        if (count > 0 && count + group.length > maxMessages) {
            break
        }
        selected.unshift(group)
        count += group.length
    }

    if (firstUserGroup && !selected.includes(firstUserGroup)) {
        selected.unshift(firstUserGroup)
    }

    return selected.flat()
}

export const graph = ({ projectId, userId }) => {
    const tools = fileTools({ projectId, userId })
    const model = createFallbackModel(tools)

    const agent = async (state) => {
        const messages = [
            new SystemMessage(systemPrompt),
            ...(state.messages || [])
        ]
        let response
        try {
            response = await model.invoke(messages)
        } catch (error) {
            console.error("[ai] generation usage summary", JSON.stringify({
                ...model.getUsageSummary(),
                failed: true
            }))
            throw error
        }

        if (!response.tool_calls?.length) {
            console.log("[ai] generation usage summary", JSON.stringify(model.getUsageSummary()))
        }

        return { messages: [response] }
    }

    const toolNode = new ToolNode(tools)
    const shouldContinue = (state) => {
        const lastMessage = state.messages?.[state.messages.length - 1]
        return lastMessage instanceof AIMessage && lastMessage.tool_calls?.length
            ? "tools"
            : "__end__"
    }

    return new StateGraph(MessagesAnnotation)
        .addNode("agent", agent)
        .addNode("tools", toolNode)
        .addEdge("__start__", "agent")
        .addEdge("tools", "agent")
        .addConditionalEdges("agent", shouldContinue)
        .compile()
}
