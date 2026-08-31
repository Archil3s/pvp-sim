# Cloudflare Access automation

NMRNL can configure its own Cloudflare Access application from GitHub Actions.

## What the workflow enforces

The repository file `cloudflare/access.config.json` is the source of truth.

The workflow:

- finds the immutable Cloudflare Worker ID for `pvp-sim`
- creates a Google identity provider if one does not already exist
- creates or updates the `NMRNL` self-hosted Access application
- assigns the entire `pvp-sim` Worker as the destination, protecting production and preview URLs
- restricts the application to Google authentication
- enables instant redirect when OTP is the only identity provider
- disables Cloudflare One Client/WARP authentication for this app
- creates one Allow policy for exactly `blenhiemmaleroom@gmail.com`
- removes other application-specific policies from the NMRNL app so an accidental Everyone policy cannot remain attached
- verifies the final state after applying it

It does not modify other Cloudflare Access applications.

## One-time GitHub setup

Because this repository is public, never commit Cloudflare credentials.

In GitHub, open:

**Settings → Secrets and variables → Actions → New repository secret**

Add:

1. `CLOUDFLARE_ACCOUNT_ID`
2. `CLOUDFLARE_API_TOKEN`
3. `GOOGLE_OAUTH_CLIENT_ID`
4. `GOOGLE_OAUTH_CLIENT_SECRET`

Create a Google OAuth client for a Web application and use Cloudflare Access's callback URL as an Authorized redirect URI. Cloudflare documents the callback format as `https://<your-team-name>.cloudflareaccess.com/cdn-cgi/access/callback`.

The Cloudflare API token needs account permissions for:

- Workers Scripts: Read
- Access: Apps and Policies: Write
- Access: Organizations, Identity Providers, and Groups: Write

If Cloudflare offers separate Read permissions for Access resources, include those as well.

## Run it

Open:

**Actions → Configure Cloudflare Access → Run workflow**

The workflow is intentionally manual so the first commit does not fail before the two GitHub secrets exist.

After the first successful run, the Cloudflare dashboard should show:

- Application: `NMRNL`
- Destination: `pvp-sim`
- Authentication: Google only
- Policy: `NMRNL Owner`
- Allowed email: `blenhiemmaleroom@gmail.com`

To change any non-secret Access setting later, edit `cloudflare/access.config.json` and run the workflow again.
