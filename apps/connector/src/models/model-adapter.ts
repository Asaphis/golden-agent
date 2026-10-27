export interface ModelDescriptor {
  id: string;
  provider: string;
  capabilities: string[];
  metadata?: Record<string, unknown>;
}

export interface ModelExecutionInput {
  model: string;
  prompt: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ModelExecutionResult {
  model: string;
  provider: string;
  response: string;
  metadata?: Record<string, unknown>;
}

export interface ModelAdapter {
  readonly provider: string;
  discover(signal?: AbortSignal): Promise<ModelDescriptor[]>;
  execute(input: ModelExecutionInput): Promise<ModelExecutionResult>;
  stream(input: ModelExecutionInput): AsyncGenerator<string, void, void>;
}
