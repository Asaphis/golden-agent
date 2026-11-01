import { OllamaAdapter } from "../../../../connector/src/models/ollama-adapter.js";
import type { ModelExecutionResult } from "../../../../connector/src/models/model-adapter.js";
import { Database } from "../../database/database.js";

export class ModelGatewayService {
  constructor(private readonly database: Database) {}

  private resolve(modelId: string, workspaceId: string): { model: ReturnType<Database["listModels"]>[number]; provider: ReturnType<Database["listProviders"]>[number] } {
    const model = this.database.listModels(workspaceId).find((item) => item.modelId === modelId && item.enabled);
    if (!model) throw new Error("MODEL_NOT_FOUND_OR_NOT_AVAILABLE");
    const provider = this.database.listProviders(workspaceId).find((item) => item.providerId === model.providerId && item.status === "active");
    if (!provider) throw new Error("MODEL_PROVIDER_NOT_AVAILABLE");
    return { model, provider };
  }

  private adapter(provider: ReturnType<Database["listProviders"]>[number]): OllamaAdapter {
    if (provider.type !== "ollama") throw new Error("MODEL_PROVIDER_UNSUPPORTED");
    const baseUrl = typeof provider.config.baseUrl === "string" ? provider.config.baseUrl : undefined;
    return new OllamaAdapter(baseUrl);
  }

  async execute(modelId: string, workspaceId: string, prompt: string, timeoutMs?: number): Promise<ModelExecutionResult> {
    if (!prompt.trim()) throw new Error("MODEL_PROMPT_REQUIRED");
    const { model, provider } = this.resolve(modelId, workspaceId);
    return this.adapter(provider).execute({ model: model.externalId, prompt, timeoutMs });
  }

  async *stream(modelId: string, workspaceId: string, prompt: string, timeoutMs?: number): AsyncGenerator<string, void, void> {
    if (!prompt.trim()) throw new Error("MODEL_PROMPT_REQUIRED");
    const { model, provider } = this.resolve(modelId, workspaceId);
    yield* this.adapter(provider).stream({ model: model.externalId, prompt, timeoutMs });
  }

  async discover(providerId: string, workspaceId: string): Promise<Array<Record<string, unknown>>> {
    const provider = this.database.listProviders(workspaceId).find((item) => item.providerId === providerId && item.status === "active");
    if (!provider) throw new Error("MODEL_PROVIDER_NOT_FOUND_OR_NOT_AVAILABLE");
    return (await this.adapter(provider).discover()).map((model) => ({ id: model.id, provider: model.provider, capabilities: model.capabilities, metadata: model.metadata }));
  }
}
