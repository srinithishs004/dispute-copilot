# Runbook: create a sandbox payment and a real dispute

Goal: produce a genuine PayPal **sandbox** dispute and work it in the browser, from login to approval. Everything here uses sandbox accounts and fake money. Run all commands from the repo root.

The main path (steps 1 to 8) uses only the browser. The `curl` and debug paths are kept at the end as the **owner appendix**.

Never paste client secrets, tokens or full request headers into chat, issues or commits. The scripts only print IDs and statuses.

## Before you start

Run `npm install` once from the repo root before using any script below.

You need a PayPal developer account with a sandbox **Business** (merchant) account, a sandbox **Personal** (buyer) account, and a REST app created under **Sandbox** (not Live).

## Step 1: Fill in `.env`

Copy `.env.example` to `.env` in the repo root and set at least `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from your sandbox REST app. Leave `PAYPAL_BASE_URL` as the sandbox URL (`https://api-m.sandbox.paypal.com`).

To sign in to the app, also set `SESSION_SECRET` (32 characters or more) and at least one account: `JUDGE_EMAIL` plus `JUDGE_PASSWORD_HASH`, or `OWNER_EMAIL` plus `OWNER_PASSWORD_HASH`. Make a hash with `npm run hash-password -w server -- '<pw>'` (the password lands in your shell history, so clear it afterwards). See the README for every key.

Success: the file exists and is not tracked by git (`git status` does not list it).

## Step 2: Start the server

```
npm run dev
```

This starts the API, the store and the job worker together, using a local PGlite database (no Postgres needed). To get a letter, also set `GEMINI_API_KEY` or `GROQ_API_KEY`. PayPal sends buyers back to `PUBLIC_BASE_URL` (default `http://localhost:3000`), so keep it matching the address you open in the browser.

`npm run dev` serves the API and the store only. To use the web app, either run `npm run build` and `npm start` and open http://localhost:3000, or run `npm run dev -w web` as well and open http://localhost:5173 (then set `PUBLIC_BASE_URL=http://localhost:5173`, because approve checks the request origin).

Success: http://localhost:3000/health shows `{"ok":true}`.

## Step 3: Create and pay for an order in the demo store

Open http://localhost:3000/store in a browser (a private window helps). Pick an item and start checkout. Log in to PayPal as the sandbox **Personal** account and approve the payment. PayPal sends you back to the store, which captures the payment for you.

Success: you see a thank-you page with your order ID (`ORD-...`). Write it down. You do not need `spike:order` or `spike:capture` for new orders; they are only for experiments.

## Step 4: Open a dispute as the buyer

Log in to https://www.sandbox.paypal.com as the same Personal buyer account. Open the payment in **Activity**, choose **Report a problem**, and pick **Item not received**.

The exact sandbox menu wording may differ from this. Write down the options you actually clicked so the next person can repeat it.

Success: the sandbox shows a dispute or case for the payment.

## Step 5: Sign in

Open the app (http://localhost:3000 locally, https://dispute-copilot-zv53.onrender.com deployed) and choose **Sign in**. Use the judge or owner account from your `.env`. The judge can read and approve; only the owner can run the sync, the sandbox settle and the debug events.

On the free Render plan the first request can take up to a minute while the service wakes. The app shows a waking up screen and retries.

Success: you land on the dashboard, signed in.

## Step 6: Find the dispute on the dashboard

The dispute arrives by webhook, usually within about 5 minutes, then the AI gathers evidence and drafts a letter. On the dashboard it appears under **Action needed** with a deadline. The owner can run the sync call from the owner appendix (A1) if the webhook is slow.

Success: your dispute is listed in **Action needed** with **Open review**.

## Step 7: Review and approve

Choose **Open review** to open `/disputes/<id>`. Read the evidence and what is missing, the recommendation (fight, partial refund or accept) with its confidence, and the letter. Edit the letter if you want. Pick the action, check the note, and approve. For a partial refund, enter the offer amount (more than 0 and less than the disputed amount).

Nothing goes to PayPal until you approve. If PayPal no longer allows the action, the page says what is allowed now.

Success: the timeline shows the action sent, and the dispute state is `ACTION_SENT`.

## Step 8: Let the buyer respond, then check the result

In the PayPal sandbox, as the buyer, open the dispute and accept the seller's offer (or decline it). PayPal reports the change by webhook and the app updates the dispute. Back on the dashboard, **Money protected** counts resolved disputes only, split into money kept and money refunded.

Success: the Review page shows the dispute resolved with PayPal's outcome, and the dashboard totals have changed.

The Dispute Analyst panel on the dashboard (wide screens only) can answer questions such as "Which disputes are due this week?". It is read only and cannot approve anything.

## Owner appendix: API and debug paths

These skip the browser. They use the `x-debug-token` header (set `DEBUG_TOKEN`), which is treated as the owner. Use them to sync, to inspect raw data or to script a run.

### A1. Check the dispute through the API

Your dispute can reach the server in two ways: the webhook (it can take a few minutes) or a manual sync. To sync right away:

```
curl -X POST -H "x-debug-token: <YOUR_DEBUG_TOKEN>" http://localhost:3000/api/disputes/sync
```

On the deployed service, replace `http://localhost:3000` with `https://dispute-copilot-zv53.onrender.com` in every command here.

Then list the disputes (the header can be replaced by a session cookie, see the browser steps):

```
curl -H "x-debug-token: <YOUR_DEBUG_TOKEN>" http://localhost:3000/api/disputes
```

Copy the `id` of your dispute (it starts with `PP-R-`) and fetch it. The AI needs a few seconds:

```
curl -H "x-debug-token: <YOUR_DEBUG_TOKEN>" http://localhost:3000/api/disputes/<disputeId>
```

Success: `localState` is `READY_FOR_REVIEW`, `evidence` is filled in, and `latestAnalysis.letterDraft` holds a letter. If you see `NEEDS_MANUAL` and `manualReason` is "AI draft unavailable", no AI key worked: check `GEMINI_API_KEY` or `GROQ_API_KEY`, then run the sync again.

The old script `npm run spike:disputes -w server` still prints the raw dispute JSON straight from PayPal, if you need it.

Warning: the raw JSON may contain sandbox buyer and seller names and email addresses. They are fake, but they still look like personal data. Redact them before pasting output into chat or Discord, or committing it.

### A2. Approve an action (fight, offer or accept)

Once `localState` is `READY_FOR_REVIEW`, read `latestAnalysis` (the AI's recommendation) and `allowedActions` (what PayPal currently lets you do). Then you decide. Nothing goes to PayPal until you call approve. The Review page does the same thing in the browser.

In PowerShell, quoting JSON on the command line breaks easily. Write the body to a file first, then send the file. Use `curl.exe` (with the `.exe`), because plain `curl` in PowerShell is a different command.

Fight (send our evidence). Save as `approve.json`:

```
{ "action": "FIGHT", "note": "Parcel was delivered on time; tracking and delivery confirmation attached." }
```

Offer (a partial refund). `offerAmount` is a string, more than 0 and less than the disputed amount:

```
{ "action": "OFFER", "note": "Offering a partial refund to settle this quickly.", "offerAmount": "12.50" }
```

Accept (refund the buyer in full):

```
{ "action": "ACCEPT", "note": "Accepting the claim and refunding the buyer in full." }
```

The `note` must be 20 to 2000 characters. Send the file:

```
curl.exe -X POST -H "x-debug-token: <YOUR_DEBUG_TOKEN>" -H "Content-Type: application/json" --data "@approve.json" http://localhost:3000/api/disputes/<disputeId>/approve
```

On the deployed service, the same call is `https://dispute-copilot-zv53.onrender.com/api/disputes/<disputeId>/approve` (and `https://dispute-copilot-zv53.onrender.com/api/disputes/<disputeId>` to fetch it again).

Success: HTTP 202 with `{"actionId": ..., "state": "PENDING"}`. Fetch the dispute again after a few seconds: `localState` becomes `ACTION_SENT` and the action's `state` is `SENT`. If you get 409 `action not allowed now`, PayPal no longer offers that action; the response shows what is allowed.

### A3. Settle a sandbox dispute (demo only)

In the sandbox you can make PayPal decide the case yourself, so the dispute reaches `RESOLVED`. PayPal only offers this for disputes under review in the claim stage, so a fresh inquiry usually answers 409 `not settleable yet` with a hint. Save as `settle.json` (`SELLER_FAVOR` or `BUYER_FAVOR`):

```
{ "outcome": "SELLER_FAVOR" }
```

```
curl.exe -X POST -H "x-debug-token: <YOUR_DEBUG_TOKEN>" -H "Content-Type: application/json" --data "@settle.json" http://localhost:3000/api/disputes/<disputeId>/sandbox/settle
```

On the deployed service, use `https://dispute-copilot-zv53.onrender.com/api/disputes/<disputeId>/sandbox/settle` instead of the localhost address (same headers and body).

To reach the claim stage: either the buyer escalates the dispute in the sandbox UI, or run locally `npm run spike:action -w server -- <disputeId> escalate`.

Success: HTTP 202 `{"state":"SETTLE_REQUESTED"}`. The server re-processes the dispute, and `localState` becomes `RESOLVED` with an `outcome` once PayPal reports it. This endpoint only works against the sandbox.

## What `localState` means

- `READY_FOR_REVIEW`: the AI has finished. A recommendation is waiting for you to approve or change.
- `ACTION_PENDING`: you approved. The action is saved and queued but not yet sent to PayPal.
- `ACTION_SENT`: PayPal accepted the action. We are waiting for PayPal and the buyer to respond.
- `NEEDS_MANUAL`: something needs a human. Read `manualReason` (for example "AI draft unavailable", or PayPal rejected the action). You can still call approve from this state.
- `RESOLVED`: PayPal closed the dispute. The `outcome` field is PayPal's outcome code, which says who won.

Earlier states you may briefly see: `NEW` (just received) and `ANALYZING` (the AI is working).

## Good to know

- Use fresh disputes for demos. Older Phase 1 disputes keep their FIGHT-only analyses.
- After an offer, if the buyer declines, PayPal hands the case back (`WAITING_FOR_SELLER_RESPONSE`) and the app re-analyzes it, so you can approve again.
- If an action FAILED with "Could not reach PayPal", check the dispute in the PayPal sandbox before approving again. The first attempt may have gone through, especially FIGHT (evidence).
- A later PayPal update re-analyzes a `NEEDS_MANUAL` dispute: the reason clears, and the failed action keeps its error in `actions`.
- If a dispute is stuck in `ACTION_PENDING` for more than 15 minutes (the worker crashed on the last try), it needs a manual database fix. Contact the developer.

## Owner appendix A4: Check the webhook arrived

PayPal cannot reach `localhost`, so locally you will not see webhooks unless you expose your machine with a tunnel; use the sync command from A1 instead. On the deployed Render service, check soon after opening the dispute. Events are saved in the database. Locally they survive restarts. On Render the data lives in Render Postgres, so it survives the service sleeping and redeploys. Use the `curl` command from step 7 of the deploy section below; a plain browser visit returns 401 because the endpoint needs the `x-debug-token` header, and it returns 404 if `DEBUG_TOKEN` is not set on the service.

Success: the list contains a `CUSTOMER.DISPUTE.CREATED` event for your dispute ID. If the list is empty, look in Render → Logs for a line starting `webhook received: CUSTOMER.DISPUTE.CREATED` (it ends with the dispute ID).

## If something goes wrong

- **401 / `invalid_client`**: the client ID or secret is wrong, or you mixed Live and Sandbox credentials. Re-copy both from the Sandbox tab of your REST app.
- **"Config error: ... is required"**: a variable in `.env` is missing or blank. The message names it.
- **Dispute not appearing**: run the sync command from A1, or wait a few minutes. The sandbox can be slow. Confirm you used the same buyer account that paid.
- **No `CUSTOMER.DISPUTE.CREATED` event**: check the webhook is subscribed to dispute events in the developer dashboard and points at the deployed server URL.
- **Webhooks fail verification (400)**: expected until the real Webhook ID is set in `PAYPAL_WEBHOOK_ID` and the service is redeployed.
- **Signature `FAILURE` even with the correct Webhook ID**: tell Claude; we may need to verify using the raw request body.
- **Buyer lands on a broken page after paying**: `PUBLIC_BASE_URL` does not match the address you are using. Fix it and start again with a new order.
- Never paste secrets or tokens anywhere. Share the `debug_id` the scripts print instead.

## Deploying the webhook receiver (Render)

1. Push this repo to GitHub.
2. In Render, choose **New → Blueprint** and pick the repo. Render reads `render.yaml` and proposes the `dispute-copilot` web service.
3. In the Render dashboard, set `PUBLIC_BASE_URL` to your Render URL once you know it, add `GEMINI_API_KEY` and/or `GROQ_API_KEY`, and fill the secret env vars: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` (use a placeholder for now) and `DEBUG_TOKEN` (any long random string you make up). For logins add `OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `JUDGE_EMAIL`, `JUDGE_PASSWORD_HASH` and `SESSION_SECRET`. For the judge guide and the dashboard add the `VITE_*` keys (`VITE_JUDGE_EMAIL`, `VITE_JUDGE_PASSWORD`, `VITE_SANDBOX_BUYER_EMAIL`, `VITE_SANDBOX_BUYER_PASSWORD`, `VITE_AG_STUDIO_LICENSE_KEY`). `VITE_*` keys are read at build time, so changing one needs a redeploy.
4. When the deploy finishes, copy the real `https://…onrender.com` URL from the Render dashboard (the service name may get a suffix) and use it wherever `<service>.onrender.com` appears below. Open `<that URL>/health`. Success: it shows `{"ok":true}`.
5. Go to developer.paypal.com → Apps & Credentials (Sandbox) → your app → Webhooks → **Add webhook**. Use the URL `https://<service>.onrender.com/webhooks/paypal` and subscribe to `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED` and `CUSTOMER.DISPUTE.RESOLVED`.
6. Copy the new **Webhook ID** into Render's `PAYPAL_WEBHOOK_ID` and redeploy.
7. After a dispute is opened, view the received events:

```
curl -H "x-debug-token: <your DEBUG_TOKEN>" https://<service>.onrender.com/debug/events
```

Note: free Render services sleep when idle. The first request after a while can take up to a minute, and PayPal may retry the webhook in the meantime.
