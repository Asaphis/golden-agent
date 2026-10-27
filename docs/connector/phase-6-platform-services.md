# Phase 6 platform services and packaging

Phase 6 adds compiled-runtime service packaging instead of launching the development TypeScript runner.

Linux has a hardened user-level systemd unit and installer. The installer builds the connector, creates a user-owned environment file with mode `0600`, installs the unit, enables it, starts it, and prints service status. The unit uses a least-privilege user service, private temporary storage, protected system paths, explicit writable data paths, and automatic restart.

Windows has a PowerShell installer that builds the compiled runtime, creates an application configuration directory, registers the connector with the Windows Service Control Manager, starts it, and supports removal. macOS has a launchd plist and installer using the compiled runtime. Termux has a Termux-compatible foreground startup script suitable for Termux:Boot. Container deployment has a dedicated connector Dockerfile with a persistent data volume and compiled entrypoint.

`pnpm validate:packaging` builds the runtime and verifies all platform artifacts and the compiled entrypoint. Linux systemd syntax was validated in this environment. Native Windows, macOS, Termux, and Docker daemon installation tests require those target environments and are explicitly not claimed as executed here.
