# EAS — Equipment Accountability System

EAS is a Cloudflare Workers application for crew equipment checkout and return. The kiosk workflow is: enter a 4-digit employee ID, verify equipment by QR code or printed asset code, review the items, then commit a timestamped sign-out or return.

## Phase 1

- 4-digit employee lookup with name confirmation
- Vehicle keys, iPads, and portable radios
- QR scanning with manual asset-code fallback
- Sign-out and return workflows
- Immutable transaction history plus current equipment state
- Current signed-out equipment API
- Noon and 8 PM Eastern report snapshots with outbound email delivery and an admin delivery audit
- 180-day default retention with transaction holds
- Cloudflare Workers Static Assets + D1

The repository contains fictional sample employees/equipment only. Do not commit the real employee roster; import it directly into D1.

## Local development

```bash
npm install
npm run db:migrate:local
npm run dev
```

Sample employee IDs: `1001` and `1002`. Sample equipment is assigned to Unit 701.

## Deployment

```bash
npm install
npm run types
npm run deploy
```

Wrangler is configured for a D1 binding named `DB`. Report snapshots are generated at noon and 8 PM in `America/New_York`. Email delivery uses Cloudflare Email Service. The sender and recipient are private runtime settings (`REPORT_FROM` and `REPORT_TO`) and are intentionally excluded from this public repository.

`RETENTION_DAYS` defaults to `180`; active retention holds and transactions backing current equipment state are excluded from automatic deletion.

## Production security

The Phase 1 kiosk API should not be exposed openly to the public Internet. Before production, restrict it to approved access or add a Cloudflare access-control layer. The 4-digit employee number identifies the employee; it is not treated as a secret authentication factor.
