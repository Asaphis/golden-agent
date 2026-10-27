# Phase 7 release hardening

Phase 7 adds production-oriented diagnostics and release gates. The connector emits structured JSON logs with timestamps, levels, service identity, event names, and redaction for tokens, secrets, passwords, and authorization values. The runtime records service lifecycle metrics and exposes readiness, connectivity, capabilities, uptime, and counters through its authenticated local status channel.

The connector entrypoint now performs bounded shutdown on SIGINT and SIGTERM and handles uncaught exceptions and unhandled promise rejections by logging the failure and stopping the service. The backend exposes `/health` and `/ready` diagnostics.

`pnpm release:check` builds the project, validates platform packaging, runs the complete connector/security/model/browser regression suite, scans implementation sources for unfinished markers, and validates whitespace. It passed in the development sandbox.

The remaining release-owner gates are native Windows, macOS, Termux, and Docker installation tests, production database/queue decisions, signed installer publication, external security review, and operational monitoring integration.
