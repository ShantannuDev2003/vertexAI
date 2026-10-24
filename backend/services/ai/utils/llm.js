
import { ChatOllama } from "@langchain/ollama";

const llm = new ChatOllama({
    model: "freehuntx/qwen3-coder:8b",
    baseUrl: "http://localhost:11434",
    temperature: 0,
});

export default llm;
