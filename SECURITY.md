# Security policy

Golden Agent Connector handles local identity files, access tokens, IPC secrets, filesystem paths, terminal commands, model access, and browser sessions. Report suspected vulnerabilities privately to the repository owner before public disclosure. Do not include real tokens, pairing codes, identity files, browser profiles, or customer data in an issue or reproduction archive.

## Supported versions

Security fixes are applied to the latest tagged release and the `main` branch. Users should upgrade to the latest release before reporting an issue that is already fixed on `main`.

## High-value security boundaries

The most important areas for review are:

- authentication and nonce replay protection for Unix-socket and loopback TCP IPC;
- pairing-code and access-token handling;
- permission enforcement before model, browser, filesystem, process, and terminal operations;
- allowed-root path resolution and symlink escape prevention;
- terminal command allowlists and child-process cleanup;
- redaction of secrets from logs and diagnostics;
- service installers, file permissions, and signal-safe shutdown.

## Local threat model

The Connector is designed for a trusted local user account and an explicitly paired backend. It is not a replacement for a host firewall, operating-system sandbox, endpoint protection, or multi-user isolation. Do not expose the IPC socket or loopback TCP port beyond the local machine, and do not run the Connector with broader filesystem or terminal permissions than required.
