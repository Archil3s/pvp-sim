# NMRNL

This repository is the Cloudflare-native port target for `Archil3s/support_worker_log`.

## Architecture
- `src/` is the React/Vite application.
- `worker/index.js` is the Cloudflare Worker API.
- `NmrnlStore` is the first persistence boundary and uses Durable Object SQLite storage.
- `wrangler.jsonc` deploys the Worker and `dist/` static assets together.

## Porting rules
- Port workflows, not Firebase implementation details.
- Keep the application responsive on phone and desktop.
- Preserve the dark visual language where practical while simplifying input-heavy screens.
- Keep support-work records structured and exportable.
- Prefer Cloudflare-native persistence and server endpoints.
- Do not commit client data, access tokens, Google tokens, or other secrets.
- `npm run build` must pass before shipping.

## History
The previous pvp-sim / Codex Supervisor implementation is preserved on `archive/pvp-sim-before-nmrnl`.
