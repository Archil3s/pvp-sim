# NMRNL

Cloudflare-native rebuild of `Archil3s/support_worker_log`.

**Important:** the source `support_worker_log` repository is reference-only. NMRNL is developed only in this repository. The original application is not modified by this port.

The pre-NMRNL state of this repository is preserved on:

`archive/pvp-sim-before-nmrnl`

## Ported now

- Private Cloudflare workspace creation
- Work / Casework / PAYE modes
- Dashboard
- Quick Entry
- Original core entry types
- Client reuse
- Home-visit odometer / KM data
- Notes and structured support-note breakdown
- Visit follow-up actions
- General client / knowledge-gap actions
- Entries search and type filtering
- Mobile + desktop navigation

## Privacy model

Each NMRNL workspace is a separate Durable Object. Creating a workspace returns a random Workspace ID and 256-bit owner key. The key is stored only in the browser and is required for every read/write request.

Back up the Workspace ID and owner key from the Workspace screen before using another device.

## Cloudflare deployment name

The application is NMRNL, but `wrangler.jsonc` temporarily retains the Worker deployment name `pvp-sim` because the existing Cloudflare Git-connected Worker still has that name. Cloudflare requires these names to match for Git builds.

After the Worker is renamed to `nmrnl` in the Cloudflare dashboard, update the Wrangler `name` field to `nmrnl`.

## Next port slices

- Entry editing
- Full support-note editor
- Calendar
- Pay period / totals
- Google Drive / Calendar
- Admin review and charts
- Selected casework modules
