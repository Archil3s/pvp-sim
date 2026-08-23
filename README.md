# Codex Supervisor Dashboard

Cloudflare-hosted live viewer for the DD Skiller Codex supervisor.

The old WebGL PvP simulator has been removed. The site now shows live Codex agent status, model routing, terminal output, Git changes, `CODEX_PROGRESS.md`, `CODEX_HANDOFF.md`, and verification results streamed by the local Windows supervisor.

## Cloudflare

The Worker creates private telemetry sessions at `POST /api/session`. Each session uses a Durable Object and has separate write and viewer tokens. Static Vite assets and the API deploy together through `wrangler.jsonc`.

## Build

```bash
npm install
npm run build
```

The existing Cloudflare Git deployment can continue using this repository. The Worker entry point is `worker/index.js` and static assets are emitted to `dist/`.
