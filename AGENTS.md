# Codex Supervisor Dashboard

This repository is the Cloudflare-hosted viewer for the local DD Skiller Codex supervisor. It no longer contains the PvP simulator.

## Architecture
- `src/` is the React/Vite viewer.
- `worker/index.js` is the Cloudflare Worker API.
- `SupervisorHub` is a Durable Object used to hold the latest private supervisor telemetry for each session and fan it out over WebSockets.
- `wrangler.jsonc` deploys the Worker and `dist/` static assets as one Cloudflare unit.

## Security
- Session creation returns separate random write and viewer tokens.
- The Windows supervisor keeps the write token locally and uses it only for telemetry POSTs.
- The browser viewer needs the session ID plus viewer token.
- Never commit live session tokens, GitHub tokens, OmniRoute keys, or other secrets.

## Development rules
- Keep the dashboard useful on mobile and desktop.
- Preserve WebSocket live updates and polling fallback.
- Keep the API backwards-compatible with supervisor telemetry payloads when possible.
- Do not reintroduce PvP simulator/Three.js code unless the repository purpose is explicitly changed again.
- `npm run build` must pass before shipping frontend changes.
