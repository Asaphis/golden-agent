# Phase 10 release validation

## Automated checks

Run from the repository root:

```bash
pnpm release:check
```

This validates TypeScript compilation, the production desktop bundle, packaging files, the full connector regression suite, and whitespace errors.

## Windows installer build

The supported reproducible build is the `Desktop Windows Build` GitHub Actions workflow in `.github/workflows/desktop-windows.yml`. Run it manually from the Actions tab or push a tag matching `v*`.

The workflow installs the pinned pnpm version, uses Node.js 22 and the stable Rust toolchain, runs the connector tests, and executes:

```powershell
pnpm --filter @golden-agent/desktop tauri build
```

It uploads both installer families:

- `Golden Agent Desktop_*_x64_en-US.msi`
- `Golden Agent Desktop_*_x64-setup.exe`

## Windows acceptance checklist

On a clean Windows machine:

1. Install the NSIS installer and confirm the application launches with the pairing screen visible.
2. Install the MSI and confirm the same startup behavior.
3. Install the connector service with `apps/connector/packaging/windows/install-service.ps1`.
4. Pair using the desktop QR/manual-code flow.
5. Confirm status, permissions, models, browser, Resources, diagnostics, and service controls communicate through authenticated TCP IPC.
6. Revoke the connector, confirm the UI returns to pairing, then pair again.
7. Rotate the token and confirm the service reconnects with the new token.
8. Uninstall and reinstall the desktop application; confirm connector data remains in `%APPDATA%\GoldenAgent` unless deliberately removed.

The sandbox cannot provide a clean Windows machine or validate WebView2, Windows Service Control Manager behavior, MSI upgrades, and NSIS uninstall behavior. Those checks are release-owner gates and are covered by the Windows workflow plus the acceptance checklist above.
