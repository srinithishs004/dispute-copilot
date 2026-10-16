# Dispute Copilot

Dispute Copilot is a PayPal disputes assistant for small sellers, built for the PayPal AI Hackathon. It talks to the PayPal sandbox APIs to help sellers understand and respond to disputes. It uses the sandbox only: no real money and no real customers.

## How it works now (Phase 1)

1. A buyer pays for an item in the demo store at `/store` (PayPal sandbox checkout).
2. The buyer opens a dispute in the PayPal sandbox.
3. PayPal sends a webhook to `POST /webhooks/paypal`. The server checks the signature, saves the event, and puts a job in the queue.
4. A worker picks up the job. It re-fetches the dispute from PayPal, matches it to our order, builds an evidence pack (plain code, no AI), and asks the AI to draft a response letter.
5. The dispute moves to `READY_FOR_REVIEW` with the letter attached. You read it with `GET /api/disputes/<id>`.

Things to know:

- **The AI never calls PayPal.** Nothing is sent to PayPal on the seller's behalf in this phase.
- **The letter is written for the FIGHT stance only.** A later phase adds an advisor that picks fight, offer or accept.
- **The job queue is a Postgres table** called `jobs`, not an external queue. A job is locked while a worker runs it (5 minute lease) and is tried up to 3 times, 30 seconds apart.
- **If no AI key works**, the dispute ends in `NEEDS_MANUAL` with the reason "AI draft unavailable".

## Run locally

1. `npm install`
2. Copy the example settings: `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`). Fill in your PayPal sandbox credentials and a `DEBUG_TOKEN` (any long random string you make up).
3. `npm run dev` starts the web server and the job worker together, in one process. Open http://localhost:3000/store.
4. `npm test` runs the tests. They never touch the network.

`npm run build` compiles the server and `npm start` runs the compiled build (this is what Render does).

## Environment variables

Set these in `.env` at the repo root (a blank value counts as not set). Never commit `.env`.

| Variable | Default | What it is |
|---|---|---|
| `PORT` | `3000` | Port the server listens on. |
| `PAYPAL_CLIENT_ID` | none, required | Sandbox REST app client ID. |
| `PAYPAL_CLIENT_SECRET` | none, required | Sandbox REST app secret. |
| `PAYPAL_BASE_URL` | `https://api-m.sandbox.paypal.com` | Must be the sandbox API host. Any other host is rejected at startup. |
| `PAYPAL_WEBHOOK_ID` | none | Webhook ID from the developer dashboard. Without it, webhooks cannot be verified. |
| `DEBUG_TOKEN` | none | Secret for the protected endpoints. If unset, those endpoints return 404. |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Public address of this server. PayPal sends the buyer back to `<PUBLIC_BASE_URL>/store/return`. Set it to your Render URL when deployed. It is not in `.env.example`; add it yourself. |
| `DATABASE_URL` | none | Postgres connection string. If unset, the app uses a local PGlite database. |
| `PGLITE_DIR` | `.data/pglite` | Folder for the PGlite data when `DATABASE_URL` is unset. |
| `RUN_WORKER_INLINE` | `true` if `DATABASE_URL` is unset, else `false` | Run the job worker inside the web process. Set `true` or `false` to override. It is not in `.env.example`; add it yourself if needed. |
| `GEMINI_API_KEY` | none | Gemini key. Tried first. |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Gemini model name. |
| `GROQ_API_KEY` | none | Groq key. Used if Gemini fails or has no key. |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model name. |

You need at least one of `GEMINI_API_KEY` or `GROQ_API_KEY` to get a letter. A provider without a key is skipped.

### Database

- With no `DATABASE_URL`, data lives in PGlite files under `.data/pglite` and survives restarts. Delete that folder to start fresh.
- Render's free plan has no persistent disk. On Render, PGlite data is wiped on every redeploy or restart. That is fine for the demo. Phase 3 may add Render Postgres.

## Endpoints

| Endpoint | Token needed | What it does |
|---|---|---|
| `GET /health` | no | Returns `{"ok":true}`. |
| `GET /store` | no | Demo store page. |
| `POST /store/checkout` | no | Starts a PayPal sandbox checkout (the store page calls it). |
| `GET /store/return` | no | PayPal sends the buyer back here. The server captures the payment. |
| `GET /store/cancel` | no | Where the buyer lands if they cancel. |
| `POST /webhooks/paypal` | no (PayPal signature) | Receives dispute webhooks. |
| `GET /debug/events` | yes | The last 50 webhook events. |
| `POST /api/disputes/sync` | yes | Pulls disputes from PayPal and queues them. Use it if a webhook is slow. |
| `GET /api/disputes` | yes | List of disputes. |
| `GET /api/disputes/<id>` | yes | One dispute with its evidence pack and latest letter. |

Send the token in the `x-debug-token` header. Example:

```
curl -H "x-debug-token: <YOUR_DEBUG_TOKEN>" http://localhost:3000/api/disputes
```

## Logging and privacy

- Logged IDs go through `maskId` (`server/src/log.ts`), so full IDs never appear in logs.
- We never log tokens, secrets, request bodies, emails, prompts or letters.
- Emails are redacted before any text is sent to an AI provider.

## Testing against the PayPal sandbox

See [docs/runbooks/sandbox-dispute.md](docs/runbooks/sandbox-dispute.md) for creating a sandbox payment and a real dispute. Typecheck the spike scripts with `npm run typecheck:scripts -w server`.
