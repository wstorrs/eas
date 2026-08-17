# EAS Cloudflare deployment runbook

EAS is designed for Cloudflare Workers with static assets and a D1 database.

## Prerequisites

- Node.js 20+
- An authenticated Cloudflare Wrangler session (`npx wrangler whoami`)
- Access to the `wstorrs/eas` repository

## First staging deployment

Run these commands from the repository root on `agent/phase-1-scaffold`:

```bash
npm install
npx wrangler whoami
npx wrangler d1 create eas-db
```

The D1 create command returns a database ID. Add that value to the `DB` entry in `wrangler.jsonc` as `database_id` before remote migrations/deployment.

Then validate and apply the database:

```bash
npm run typecheck
npx wrangler d1 migrations apply eas-db --remote
npx wrangler deploy --dry-run
npx wrangler deploy
```

After deployment, verify:

```bash
curl https://<worker-url>/api/health
```

Expected response:

```json
{"ok":true,"service":"eas"}
```

The migration set currently includes fictional development data. Do not replace it with a real employee roster in GitHub. Real employee data should be imported directly into D1 after the development workflow is verified.

## Scheduled reports

The Worker runs an hourly Cron Trigger and generates accountability snapshots when the local Eastern hour is Noon or 8 PM. This keeps the schedule aligned with `America/New_York` across daylight-saving changes. Email delivery is intentionally not configured yet.

## Retention

Routine reports and transaction history are retained for the configured `RETENTION_DAYS` value (default 180). Transactions with active retention holds are excluded from deletion.

## Production checklist

Before production use:

1. Verify D1 migrations against the staging database.
2. Verify employee lookup, sign-out, and return using fictional records.
3. Add access control for administrative routes and deployment administration.
4. Select and configure the outbound email provider.
5. Configure report recipients.
6. Import the real employee roster directly into D1, not GitHub.
7. Replace development equipment/vehicle records with the approved fleet inventory.
8. Confirm QR labels and manual asset codes against physical equipment.
