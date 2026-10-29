# Golden Agent Connector release guide

This document is the release-owner runbook for the headless Connector. The desktop manager and Connector share the same authenticated local IPC contract, but the Connector can be installed and operated independently on Linux, macOS, Windows, Termux, SSH sessions, and Docker.

## Release contents

The source release contains:

- the TypeScript Connector runtime and authenticated local IPC;
- the headless CLI with human-readable and `--json` output;
- platform service installers for systemd, launchd, Windows, Termux, and Docker;
- integration tests for pairing, permissions, authentication, replay protection, filesystem and terminal safety, models, browser operations, and service lifecycle.

Native desktop installers are platform-specific build outputs. They must be built and smoke-tested on their target operating systems before publication; a Linux source build is not a substitute for a Windows, macOS, or Android validation run.

## Fresh installation

1. Install Node.js 22 or newer and pnpm 11 or newer.
2. Obtain the tagged source release and verify its SHA-256 checksum.
3. Run `pnpm install --frozen-lockfile` and `pnpm build`.
4. Pair once with `pnpm connector pair` or `node dist/apps/connector/src/main.js pair`.
5. Start the platform service using [the headless platform guide](./headless-platforms.md).
6. Verify with `pnpm connector status --json` and `pnpm connector doctor --json`.

The Connector stores identity, access tokens, IPC secrets, and runtime data in the configured data directory. Treat that directory as sensitive and do not copy it into an issue, build artifact, or shared backup without protection.

## Upgrade procedure

1. Record the current version, service status, and data-directory backup location.
2. Stop the Connector service using the platform-native stop command.
3. Back up the Connector identity and token files before replacing the source tree.
4. Fetch the new tag, run `pnpm install --frozen-lockfile`, and run `pnpm build`.
5. Keep the existing identity, token, IPC secret, and permission configuration; do not pair again unless the identity was intentionally revoked.
6. Restart the service and verify `status --json`, `doctor --json`, and the expected permission list.
7. If validation fails, stop the new service, restore the previous source tree and backup, and start the previous version.

Upgrades must not silently broaden permissions. Review `CONNECTOR_PERMISSIONS`, `CONNECTOR_ALLOWED_ROOTS`, and `CONNECTOR_TERMINAL_COMMANDS` after every upgrade.

## Security checklist

Before publication, confirm that:

- IPC secrets and token files are mode `0600` on Unix-like systems and stored in the per-user application data directory on Windows;
- Unix IPC sockets are not world-readable and Windows IPC binds only to loopback;
- every IPC request contains a valid secret and a fresh nonce;
- invalid permissions, path escapes, disallowed terminal commands, and unauthenticated requests are rejected;
- pairing codes and access tokens are never included in structured logs;
- the service shuts down on `SIGINT` and `SIGTERM` and removes stale service state safely;
- the generated release contains no `.data`, `node_modules`, credentials, or local build output;
- native installers have been tested on their target platforms.

## Release validation

From a clean checkout, run:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm validate:packaging
pnpm test:connector
pnpm release:source --version 0.1.0 --output dist/release
```

`release:source` creates a source archive, a SHA-256 checksum, and a JSON manifest containing the commit and package version. The final release must also record the native platform test results and the exact commit used to build each installer.

## Known platform boundaries

The Connector does not install Ollama or a browser runtime. Model discovery requires a reachable Ollama service, and browser operations require a supported Playwright browser runtime. Minimal containers and Termux installations may therefore report those capabilities as unavailable while continuing to provide authenticated IPC, permissions, diagnostics, and filesystem or terminal features.
