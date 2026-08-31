# NMRNL

Cloudflare-native rebuild of `Archil3s/support_worker_log`.

**Important:** the source `support_worker_log` repository is reference-only. NMRNL is developed only in this repository. The original application is not modified by this port.

The pre-NMRNL state of this repository is preserved on:

`archive/pvp-sim-before-nmrnl`

## Ported now

- Private Cloudflare workspace creation
- Work-only mode
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
- Full Work support-note editor with structured template and Incomplete / In Progress / Finished / Submitted status
- Work calendar with overlap / missing-note / follow-up flags
- Google Calendar draft export with per-entry calendar status and automatic reset when event details change
- Work pay-period fortnight totals and daily breakdown
- Billable-time rules with 15/30-minute note allowances
- Work earnings + travel reimbursement using editable hourly/KM rates
- Invoice numbering, Not Submitted / Submitted / Paid tracking, owed/paid totals and baseline-change tracking
- Mobile printable invoice/PDF view
- Google Drive Work folder setup (NMRNL Work / Client Notes / Invoices)
- Support-note Google Doc sync into client → invoice-period → work-type folders
- Invoice-period Drive folder sync with invoice summary Google Doc and shortcuts to support notes
- Admin Review queue for replies, calendar gaps, missing notes, open actions and important texts
- Fortnight analytics with trends, workflow health, billable-time mix and editable weekly hours goal
- Visual Work charts for daily hours/KM, cumulative earnings, client hours and entry-type mix
- Persistent Active Visit timer with Start → live draft → Finish & Save workflow
- Active-visit odometer capture, draft notes and structured support-note/text close-out
- Active Visit survives refresh/device changes because the running visit is stored in the Durable Object
- Finished timed visits create normal Work entries, billable time, next actions and Calendar-ready records
- Work dashboard parity with Today + Current Fortnight totals, admin health, quick actions and last-entry summary
- Monthly Work summary with contact-type totals, unfinished-note/action counts and iOS Share Sheet support
- Mobile + desktop navigation

## Temporary build access

The login wall is temporarily disabled while Work mode is being ported. The app opens the single NMRNL Durable Object workspace directly. The existing Cloudflare Access + Google Authenticator code remains in the repository behind `TEMPORARY_LOGIN_BYPASS` and can be re-enabled by setting the switch back to `false`.

**Do not treat the current deployment as private until the login wall is restored.**

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

- Deeper Drive sync and note-folder reconciliation


## Google Drive runtime configuration

The Work Google Drive port uses Google Identity Services in the browser and the Drive + Docs APIs. Set the Worker runtime variable `GOOGLE_OAUTH_CLIENT_ID` to the public OAuth Web client ID. The OAuth client must allow the NMRNL production origin as an Authorized JavaScript origin. No Google client secret is exposed to the browser.
