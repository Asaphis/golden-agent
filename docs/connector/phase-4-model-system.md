# Phase 4 model system

Phase 4 introduces a provider-neutral model adapter boundary inside the connector. A `ModelAdapter` can discover models, execute a prompt, and stream response chunks while accepting abort signals and bounded timeouts.

The first provider is `OllamaAdapter`. It supports `/api/tags` discovery, non-streaming `/api/generate` execution, and newline-delimited streaming generation. The adapter converts provider responses into the shared model descriptor and execution result shapes.

The connector core now routes `models.discover` through the adapter, routes `models.execute` through the adapter, and provides `models.stream` as a streaming-aware operation boundary. All model execution still requires the appropriate `model.discovery` or `model.use` permission.

The current protocol collects streamed chunks into the task result. A later interface phase can expose those chunks as live UI events without changing the provider boundary. Provider fallback, hosted-model adapters, and production model credential management remain separate additions.
