import type { ModelAdapter, ModelDescriptor, ModelExecutionInput, ModelExecutionResult } from "./model-adapter.js";

export class OllamaAdapter implements ModelAdapter {
  readonly provider = "ollama";
  constructor(private readonly baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434") {}

  async discover(signal?: AbortSignal): Promise<ModelDescriptor[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: signal ?? AbortSignal.timeout(2_000) });
      if (!response.ok) return [];
      const body = await response.json() as { models?: Array<Record<string, unknown>> };
      return (body.models ?? []).map((model) => ({ id: String(model.name ?? ""), provider: this.provider, capabilities: ["text"], metadata: model }));
    } catch { return []; }
  }

  async execute(input: ModelExecutionInput): Promise<ModelExecutionResult> {
    if (!input.model || !input.prompt) throw new Error("Model and prompt are required");
    const response = await fetch(`${this.baseUrl}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: input.model, prompt: input.prompt, stream: false }), signal: input.signal ?? AbortSignal.timeout(Math.min(input.timeoutMs ?? 120_000, 300_000)) });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    return { model: input.model, provider: this.provider, response: String(body.response ?? ""), metadata: body };
  }

  async *stream(input: ModelExecutionInput): AsyncGenerator<string, void, void> {
    if (!input.model || !input.prompt) throw new Error("Model and prompt are required");
    const response = await fetch(`${this.baseUrl}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: input.model, prompt: input.prompt, stream: true }), signal: input.signal ?? AbortSignal.timeout(Math.min(input.timeoutMs ?? 120_000, 300_000)) });
    if (!response.ok || !response.body) throw new Error(`Ollama stream returned HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const item = JSON.parse(line) as { response?: string; done?: boolean };
        if (item.response) yield item.response;
        if (item.done) return;
      }
    }
  }
}
