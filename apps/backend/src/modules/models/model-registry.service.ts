import { randomUUID } from "node:crypto";
import { Database, type ModelRecord, type ProviderRecord } from "../../database/database.js";

export class ModelRegistryService {
  constructor(private readonly database: Database) {}

  listProviders(): ProviderRecord[] { return this.database.listProviders(); }
  listModels(): ModelRecord[] { return this.database.listModels().filter((model) => model.enabled); }

  registerProvider(input: { name: string; type: string; config?: Record<string, unknown> }): ProviderRecord {
    const record: ProviderRecord = { providerId: randomUUID(), name: input.name.trim().slice(0, 120), type: input.type.trim().slice(0, 80), status: "active", config: input.config ?? {}, createdAt: new Date().toISOString() };
    if (!record.name || !record.type) throw new Error("PROVIDER_NAME_AND_TYPE_REQUIRED");
    this.database.upsertProvider(record);
    return record;
  }

  registerModel(input: { providerId: string; externalId: string; displayName?: string; capabilities?: string[] }): ModelRecord {
    if (!this.database.listProviders().some((provider) => provider.providerId === input.providerId)) throw new Error("PROVIDER_NOT_FOUND");
    const record: ModelRecord = { modelId: randomUUID(), providerId: input.providerId, externalId: input.externalId.trim(), displayName: (input.displayName ?? input.externalId).trim().slice(0, 160), capabilities: input.capabilities ?? ["text"], enabled: true, createdAt: new Date().toISOString() };
    if (!record.externalId) throw new Error("MODEL_EXTERNAL_ID_REQUIRED");
    this.database.upsertModel(record);
    return record;
  }
}
