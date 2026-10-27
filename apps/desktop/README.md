# Golden Agent Desktop Manager

The desktop manager is the local control plane for the connector service. It is intentionally separate from the connector brain.

```text
Desktop UI → typed native bridge → authenticated connector IPC → connector service
```

## Current foundation

The first dashboard includes connector status, pairing-code entry, runtime health, capability chips, service metrics, revoke controls, and navigation placeholders for permissions, capabilities, and logs.

The UI calls `src/services/connector-api.ts`. In a browser development session it uses a safe development fallback. The future Tauri shell will expose the same `window.goldenAgent` bridge with native implementations backed by the connector IPC client. The UI does not open sockets or read connector secrets directly.

## Run

From the repository root:

```bash
pnpm install
pnpm --filter @golden-agent/desktop dev
pnpm --filter @golden-agent/desktop build
```

The native Tauri shell is the next desktop milestone. This sandbox currently does not include the Rust/Tauri toolchain, so the UI build is validated independently before adding native packaging.

## Native shell

The `src-tauri/` project now defines the native window and typed commands:

```text
connector_status       → authenticated local IPC status
connector_capabilities → authenticated local IPC capabilities
connector_pair         → start the compiled connector with a pairing code
connector_revoke       → reserved for the backend account-session milestone
```

The JavaScript bridge invokes these commands when running inside Tauri and keeps a development-only fallback in browser mode. Native compilation and installer packaging must be run on a machine with Rust, the Tauri system libraries, and the target operating system.
