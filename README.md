# Dispute Copilot

Dispute Copilot helps a small seller deal with PayPal disputes. When a buyer opens a dispute, it gathers the evidence, recommends fight, partial refund or accept, and drafts the response letter. The seller reads it and decides. Nothing goes to PayPal until the seller approves.

It is an entry for the PayPal AI Hackathon and runs on the PayPal sandbox only: no real money and no real customers.

- Live: https://dispute-copilot-zv53.onrender.com
- Judges: open [`/guide`](https://dispute-copilot-zv53.onrender.com/guide) for the sandbox accounts and a step by step walkthrough.

## Real result

On Oct 27, 2026 a $25 sandbox order was disputed by the buyer. The app recommended a partial refund, the seller approved a $12.50 offer in PayPal, the buyer accepted, and the dispute resolved. That is the one end to end run so far.

## Features

- **Review page.** One screen per dispute: the evidence and what is missing, the AI recommendation with its confidence, an editable letter, and the approve step. The seller picks the action. The AI never calls PayPal and never approves.
- **AG Studio dashboard.** Disputes, actions and evidence gaps in AG Studio, with two custom widgets (Action needed and Money protected), a chart set and a grid of all disputes. Themed with the Kaala design system, night and day.
- **Dispute Analyst.** A custom agent on the AG Studio Agent Framework. It answers questions about the dashboard data in plain English and hands chart building to Studio's built-in agents. It is read only.
- **AI through a server proxy.** Gemini is tried first, then Groq. The browser never sees an AI key: the agent panel posts to `POST /api/agent/turn` and the server calls the provider.
- **PayPal sandbox webhooks and actions.** Dispute webhooks are verified and queued. Approved actions (fight, offer, accept) are sent to the PayPal Disputes API by a worker.
- **Two logins.** An owner (everything) and a judge (read and approve, no sync, settle or debug endpoints).

## Architecture

```
Buyer ── pays ──> /store (server-rendered demo store) ──> PayPal sandbox Orders API
Buyer opens a dispute in the PayPal sandbox
        │
        ▼ webhook
POST /webhooks/paypal ── verify signature ── save event ── queue job (jobs table)
        │
        ▼
Worker (runs inline in the web process)
  fetch dispute ── match order ── evidence pack (code) ── advisor (AI) ── letter (AI)
  state: READY_FOR_REVIEW
        │
        ▼
Browser: React app (web/, served by Express)
  /login ── /dashboard (AG Studio + Dispute Analyst) ── /disputes/:id (Review) ── /guide
        │ session cookie
        ▼
Express API: /auth  /api/dashboard  /api/disputes  /api/agent/turn
  approve ── queue action job ── worker ── PayPal Disputes API
  agent turn ── Gemini, then Groq (keys stay on the server)

Postgres (Render) or PGlite (local) holds orders, events, disputes, jobs and actions.
```

One Render web service serves the API, the store and the built web app, so there is one URL and the cookie is same site. The job queue is a Postgres table, not an external queue.

## Environment variables

Set these in `.env` at the repo root (a blank value counts as not set) or in the Render dashboard. Never commit `.env`. `.env.example` lists the keys you are most likely to set; a blank value means default or off.

| Variable | What it is for |
|---|---|
| `PORT` | Port the server listens on. Default 3000. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox REST app credentials. Required. |
| `PAYPAL_BASE_URL` | PayPal API host. Must be the sandbox host; anything else is rejected at startup. |
| `PAYPAL_WEBHOOK_ID` | Webhook ID from the PayPal developer dashboard. Without it, webhooks cannot be verified. |
| `PUBLIC_BASE_URL` | Public address of this server. PayPal returns buyers to it, and the approve route checks the request origin against it. |
| `DEBUG_TOKEN` | Optional secret for the `x-debug-token` header on the API (treated as owner). If unset, token access is off. |
| `OWNER_EMAIL`, `OWNER_PASSWORD_HASH` | Owner login. Both or neither. |
| `JUDGE_EMAIL`, `JUDGE_PASSWORD_HASH` | Judge login. Both or neither. Must differ from the owner email. |
| `SESSION_SECRET` | Signs the session cookie. 32 characters or more. Needed for any login. |
| `TRUST_PROXY` | Reverse proxy hops to trust for client IPs. Default 1 in production, else 0. |
| `DATABASE_URL` | Postgres connection string. If unset, a local PGlite database is used. |
| `PGLITE_DIR` | Folder for PGlite data when `DATABASE_URL` is unset. Default `.data/pglite`. |
| `RUN_WORKER_INLINE` | Run the job worker inside the web process. Default on when `DATABASE_URL` is unset; `render.yaml` sets it on. |
| `STORE_NAME` | Seller name the AI letter signs with. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini key and model. Tried first. |
| `GROQ_API_KEY`, `GROQ_MODEL` | Groq key and model. Used when Gemini fails or has no key. |
| `LLM_TIMEOUT_MS` | Time limit for each AI call, 5000 to 90000. |
| `VITE_JUDGE_EMAIL`, `VITE_JUDGE_PASSWORD` | Judge login shown on `/guide`. Build time and public, so use judge-only sandbox values. |
| `VITE_SANDBOX_BUYER_EMAIL`, `VITE_SANDBOX_BUYER_PASSWORD` | Sandbox buyer account shown on `/guide`. Build time and public. |
| `VITE_AG_STUDIO_LICENSE_KEY` | AG Studio licence key, a public client key. Build time. |

`VITE_*` keys are read when `npm run build` runs, so after changing one you must rebuild (on Render, redeploy). You need at least one of `GEMINI_API_KEY` or `GROQ_API_KEY` to get a letter. If no AI key works, the dispute ends in `NEEDS_MANUAL` with the reason "AI draft unavailable".

## Run locally

Needs Node 22.

1. `npm ci`
2. `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`) and fill in your PayPal sandbox credentials, an AI key, the login keys and `SESSION_SECRET`.
3. Production style, one process serving everything:
   ```
   npm run build
   npm start
   ```
   Open http://localhost:3000. With no `DATABASE_URL` it uses PGlite and runs the worker inline.

   `npm start` does not read `.env`: only `npm run dev` loads it. To run the built server with your `.env`, from the repo root:
   ```
   node --env-file=.env server/dist/index.js
   ```
   or export the variables in your shell first and then run `npm start`. Note the split: `npm run build` reads the `VITE_*` keys from the root `.env` (Vite's `envDir` points there), but the built server reads only the process environment. Run the build with the `VITE_*` values in `.env` (or exported), and give the server its own values as above.
4. Dev mode, two terminals:
   ```
   npm run dev            # API, store and worker on :3000 (restarts on change)
   npm run dev -w web     # Vite dev server on :5173, proxies /auth /api /store /health to :3000
   ```
   Open http://localhost:5173. The approve route checks the request origin against `PUBLIC_BASE_URL`, so set `PUBLIC_BASE_URL=http://localhost:5173` for approving in dev mode, or use the built app on :3000.

### Password hashes

Logins store only scrypt hashes. Make one with:

```
npm run hash-password -w server -- '<pw>'
```

Put the output in `OWNER_PASSWORD_HASH` or `JUDGE_PASSWORD_HASH`. The password is passed as a command line argument, so it lands in your shell history. Clear that history afterwards, or run the command in a throwaway shell.

## Tests

```
npm test -w server     # about 3.5 minutes, no network
npm test -w web
npm run build          # builds server and web
```

Server tests use supertest and PGlite with PayPal and AI calls mocked. Web tests use Vitest, jsdom and Testing Library.

## Known limitations

- **The sandbox refuses the seller settle step.** The owner-only `POST /api/disputes/<id>/sandbox/settle` could not settle a dispute in our runs. The demo resolves by the buyer accepting the offer in the PayPal sandbox instead.
- **Cold start.** On Render's free plan the service sleeps when idle, and the first request can take up to a minute. The app shows a waking up screen meanwhile.
- **AG Studio licence watermark.** Without `VITE_AG_STUDIO_LICENSE_KEY` the dashboard shows AG Studio's trial watermark on any host other than localhost.
- **The Dispute Analyst needs a wide screen.** On phones the dashboard shows the widgets and a note, but not the chat panel.

## Logging and privacy

- Logged IDs go through `maskId` (`server/src/log.ts`), so full IDs never appear in logs.
- Tokens, secrets, passwords, cookies, request bodies, emails, prompts and letters are never logged.
- Emails are redacted before any text is sent to an AI provider.

## More

- [Runbook: create a sandbox payment and a dispute](docs/runbooks/sandbox-dispute.md)
- [Main design spec](docs/superpowers/specs/2026-10-13-dispute-copilot-design.md) and [Phase 3 spec](docs/superpowers/specs/2026-10-27-phase3-seller-app-design.md)
