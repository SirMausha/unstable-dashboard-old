# Uma Club Dashboard

Online club performance dashboard for Dust Bunny, Dirt Bunny, Damp Bunny, and Dusk Bunny.

- **Public:** overview charts/members at `/`, applications at `/apply`
- **Tournaments:** Discord login at `/tourney` — rostered players pick Umas by round (managers can edit all)
- **Staff:** Discord login at `/staff` — applicants, planner, tournaments, blacklist, club settings
- **Local:** optional SQLite management app (`npm run dev`) for offline planner/settings/publish

## Online stack (Vercel free)

- Vite React frontend
- Vercel serverless API routes under `api/`
- Neon Postgres for applicants (`DATABASE_URL`)
- Discord OAuth for managers (`config/access.json` ACL)
- Live uma.moe reads via `UMA_API_KEY` (never exposed to the browser)

## Deploy to Vercel

1. Create a free [Neon](https://neon.tech) Postgres database and copy the connection string.
2. Create a Discord application at <https://discord.com/developers/applications>:
   - OAuth2 → Redirects: `https://YOUR_DOMAIN/api/auth/callback`
   - Copy Client ID and Client Secret
3. Put your Discord user ID in `config/access.json` (replace the placeholder).
4. Import the repo into Vercel. Set env vars:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon connection string |
| `DISCORD_CLIENT_ID` | Discord app client ID |
| `DISCORD_CLIENT_SECRET` | Discord app client secret |
| `SESSION_SECRET` | Long random string for JWT cookies |
| `UMA_API_KEY` | uma.moe API key |
| `SITE_URL` | Canonical site URL, e.g. `https://your-app.vercel.app` |
| `DISCORD_APPLY_WEBHOOK_URL` | Optional. Discord webhook URL for the applications channel — posts an embed (+ 30-day chart) on each apply |

5. Deploy. Open `/` for the overview, `/apply` to submit, `/staff` to manage, `/tourney` for tournament picks.

To get the webhook URL: Discord channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL.

Local online preview (after `npm i -g vercel` and env vars in `.env`):

```bash
npm run dev:online
```

## Local SQLite workspace

Still available for transfer planning, club settings, and GitHub Pages publish:

1. Copy `.env.sample` to `.env` and set `UMA_API_KEY`.
2. `npm install`
3. `npm run dev` → <http://127.0.0.1:5173>

## Commands

- `npm run dev` — local SQLite API + management UI
- `npm run dev:online` — Vercel-style local API + online UI
- `npm run build:vercel` — production frontend for Vercel
- `npm run build:public` — static GitHub Pages build
- `npm test` / `npm run typecheck`

## Privacy

Public responses include Uma IDs, IGNs, club targets, statuses, and performance.
They never include Discord IDs, Discord usernames, private notes, or secrets.
Staff-only APIs require an allowlisted Discord session.
