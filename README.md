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
- Work entry editing
- Work calendar with overlap / missing-note / follow-up flags
- Work pay-period fortnight totals and daily breakdown
- Mobile + desktop navigation

## Authentication and privacy

Each NMRNL workspace is a separate Durable Object and is enrolled into a TOTP authenticator during setup.

1. Create a workspace.
2. Scan the generated QR code with Google Authenticator (or another compatible TOTP app).
3. Verify the first 6-digit code.
4. NMRNL issues a temporary browser session token.

A new browser signs in with the Workspace ID plus a current 6-digit Authenticator code. TOTP attempts are rate-limited inside the workspace Durable Object.

NMRNL is locked to the single approved account `blenhiemmaleroom@gmail.com`.

## Cloudflare Access automation

Cloudflare Access is now managed from the repository.

The source of truth is:

`cloudflare/access.config.json`

Run the GitHub Action:

`Actions → Configure Cloudflare Access → Run workflow`

It enforces:

- Access application name `NMRNL`
- Worker destination `pvp-sim`
- production + preview protection
- One-time PIN as the only identity provider
- instant redirect to the OTP login
- exact-email Allow policy for `blenhiemmaleroom@gmail.com`
- removal of other application-specific policies from the NMRNL Access app
- 24 hour Access session duration

The workflow requires these GitHub Actions repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

See `cloudflare/README.md` for the one-time setup and required Cloudflare API token permissions.

NMRNL no longer sends its own recovery email. Cloudflare Access is the email ownership check. After Cloudflare verifies `blenhiemmaleroom@gmail.com`, NMRNL can replace a lost Google Authenticator secret with a new QR code. There is no `RECOVERY_FROM_EMAIL` requirement.


## GitHub production deployment

NMRNL also deploys directly from GitHub Actions using Wrangler.

The workflow:

`.github/workflows/deploy-nmrnl.yml`

runs on every push to `main` and can also be started manually from GitHub Actions. It builds the Vite application and runs `wrangler deploy` with the repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

This deployment path does **not** use the Cloudflare Workers Builds build token. Once this GitHub workflow deploys successfully, the old Cloudflare Git Builds integration can be disabled or disconnected to stop stale build-token failures.

The Cloudflare API token used by GitHub must include **Workers Scripts: Edit** in addition to the Access permissions used by the Access configuration workflow.

## Cloudflare deployment name

The application is NMRNL, but `wrangler.jsonc` temporarily retains the Worker deployment name `pvp-sim` because the existing Cloudflare Git-connected Worker still has that name. Cloudflare requires these names to match for Git builds.

After the Worker is renamed to `nmrnl` in the Cloudflare dashboard, update the Wrangler `name` field to `nmrnl`.

## Next port slices

- Full support-note editor
- Google Calendar integration
- Pay-period earnings / invoice workflow
- Google Drive / Calendar
- Admin review and charts
- Selected casework modules
