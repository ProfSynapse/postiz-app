# Rotate an organization's Public API key

In **Settings → Public API**, an organization **Admin** or **Superadmin** can
choose **Regenerate key**. The confirmation explains that the old Public API
key and MCP URL stop working immediately. Cancel leaves the key unchanged.
After confirmation, reveal/copy the replacement key or MCP URL and update every
consumer. The current settings page refreshes both values together.

Plan the consumer update before confirming: there is one active API key per
organization and no overlap period. Check CMS environment variables, publishing
scripts, automation credentials and MCP client configuration. A variable edit
may require redeploying that consumer. Existing scheduled posts and connected
social accounts do not use this Public API key and are not changed by regeneration.

If the request fails or the response is lost, refresh the page to load the current
key before retrying. The server may already have committed the change. The page
disables further regeneration/copying in that uncertain state rather than
automatically issuing another key.

## Endpoint and security boundary

`POST /settings/api-key/regenerate` takes `{"confirm": true}` and returns only
`{"apiKey": "<replacement>"}` with `Cache-Control: no-store`. It is a browser
session endpoint, not part of `/public/v1`; the old Public API key cannot authorize
its own replacement. The authenticated user's selected organization determines
the target. Caller-supplied organization IDs are ignored.

The endpoint checks active membership and `ADMIN`/`SUPERADMIN` explicitly even
when self-hosted billing policies allow every section. It also requires the
request's `Origin` to equal the configured `FRONTEND_URL` origin, protecting
SameSite=None session cookies from cross-site key resets. Missing or invalid
frontend configuration fails closed.

Keys use 32 cryptographically random bytes encoded as hex. The update compares
the organization's previously loaded key, so a concurrent replacement returns
409 rather than overwriting it. The old key then fails both the Public API's
organization lookup and the MCP URL's per-request lookup. No social credentials,
post records, application signing secrets or schema changes are involved.

Deploying the feature adds the control; it does not rotate an existing key.
Rolling the application image back does not undo a key already regenerated.

## Validation

`pnpm test:security` includes real authenticated Nest HTTP checks for roles,
membership, organization scoping, confirmation, Origin and response caching;
repository/authentication checks for replacement and stale-key rejection; and
DOM interaction tests for cancellation, duplicate-click prevention, updated
API/MCP copy actions and uncertain-response handling. Fixtures use dummy keys
only and do not touch live credentials or external providers.
