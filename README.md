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

## Authentication and privacy

Each NMRNL workspace is a separate Durable Object and is enrolled into a TOTP authenticator during setup.

1. Create a workspace.
2. Scan the generated QR code with Google Authenticator (or another compatible TOTP app).
3. Verify the first 6-digit code.
4. NMRNL issues a temporary browser session token.

A new browser signs in with the Workspace ID plus a current 6-digit Authenticator code. TOTP attempts are rate-limited inside the workspace Durable Object.

NMRNL is additionally locked to one account/recovery email: `blenhiemmaleroom@gmail.com`. Recovery codes are never sent to any other address. If Authenticator access is lost, email recovery verifies a short-lived code and then forces a new Authenticator QR enrollment before access is restored.

Legacy owner-key workspaces can be upgraded in-place from the Workspace screen. Once the QR setup is confirmed, the old owner-token bypass is removed.

### Recovery email delivery

The recovery flow is implemented, but Cloudflare still needs an outbound sender configured. NMRNL supports either:

- a Worker email binding named `RECOVERY_EMAIL`, plus `RECOVERY_FROM_EMAIL`; or
- Cloudflare Email Service REST credentials in `CLOUDFLARE_EMAIL_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`, and `RECOVERY_FROM_EMAIL`.

The sender domain must be onboarded to Cloudflare Email Service. The destination is fixed in code to `blenhiemmaleroom@gmail.com` and cannot be changed through the UI.

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
