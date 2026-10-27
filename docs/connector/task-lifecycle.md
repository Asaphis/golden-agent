# Phase 1 connector task lifecycle

Phase 1 adds a persisted task layer between the backend and connector.

```text
queued → running → succeeded
                 ↘ failed
                 ↘ timed_out
                 ↘ cancelled
```

## API

Create and dispatch a task:

```http
POST /v1/connectors/:connectorId/tasks
Content-Type: application/json

{"operation":"health.check","input":{},"timeoutMs":30000}
```

Read task state:

```http
GET /v1/tasks/:taskId
```

Cancel a task:

```http
POST /v1/tasks/:taskId/cancel
```

Retry a failed, timed-out, or cancelled task:

```http
POST /v1/tasks/:taskId/retry
```

The backend persists task status, progress, result, error, attempt count, timestamps, and artifact metadata. The connector reports progress events and returns a task-correlated result. The backend timeout marks an unfinished task as `timed_out`; cancellation marks it as `cancelled` and sends a cancellation message to the connector.

The current cancellation protocol prevents a late result from changing a cancelled task. Long-running operation implementations will be upgraded to use abort signals in the next phase of execution hardening.
