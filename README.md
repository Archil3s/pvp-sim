# NMRNL

Cloudflare-native rebuild of `Archil3s/support_worker_log`.

This repository was previously the `pvp-sim` / Codex Supervisor Cloudflare project. The pre-NMRNL state is preserved on:

`archive/pvp-sim-before-nmrnl`

## Direction

NMRNL will port the useful workflows from Support Worker Log into a web-first Cloudflare application:

- Quick Entry
- Work / PAYE / casework modes
- Clients and entries
- Support notes and follow-up actions
- Calendar and reporting
- Pay-period / invoice helpers
- Personal modules where they still make sense
- Google Drive / Calendar integration in later slices

## Cloudflare

The existing Vite + Cloudflare Worker deployment structure is retained so the current Git-connected Cloudflare project can be reused.

The Worker service name is now `nmrnl`.

Initial persistence uses a Durable Object with SQLite-backed storage. That avoids introducing an unconfigured D1 database during the first deployment. We can split larger datasets into D1/R2 once the core port is stable.

## Build

```bash
npm install
npm run build
```
