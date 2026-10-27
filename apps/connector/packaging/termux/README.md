# Headless and Termux operation

The connector core and service do not require a graphical interface.

## SSH/Linux

```bash
pnpm install
pnpm dev:connector pair
pnpm dev:connector service --pairing-code GLA-XXXX-XXXX
```

For a persistent Linux deployment, use the systemd unit under `../systemd/`.

## Termux

The connector can run in terminal mode where Node.js and the required local runtime are available:

```bash
pkg install nodejs-lts
pnpm install
pnpm dev:connector pair
pnpm dev:connector service --pairing-code GLA-XXXX-XXXX
```

Android storage, background-process, browser, and model-runtime restrictions apply. The connector must report unavailable capabilities instead of claiming that desktop-only operations work on Termux.
