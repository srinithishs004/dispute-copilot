# Runbook: create a sandbox payment and a real dispute

Goal: produce a genuine PayPal **sandbox** dispute so we can see what the Disputes API and webhooks really return. Everything here uses sandbox accounts and fake money. Run all commands from the repo root.

Never paste client secrets, tokens or full request headers into chat, issues or commits. The scripts only print IDs and statuses.

## Before you start

Run `npm install` once from the repo root before using any script below.

You need a PayPal developer account with a sandbox **Business** (merchant) account, a sandbox **Personal** (buyer) account, and a REST app created under **Sandbox** (not Live).

## Step 1: Fill in `.env`

Copy `.env.example` to `.env` in the repo root and set at least `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from your sandbox REST app. Leave `PAYPAL_BASE_URL` as the sandbox URL (`https://api-m.sandbox.paypal.com`).

Success: the file exists and is not tracked by git (`git status` does not list it).

## Step 2: Start the server

```
npm run dev
```

This starts the web server and the job worker together, using a local PGlite database (no Postgres needed). Set `DEBUG_TOKEN` in `.env` first. To get a letter, also set `GEMINI_API_KEY` or `GROQ_API_KEY`. PayPal sends buyers back to `PUBLIC_BASE_URL` (default `http://localhost:3000`), so keep it matching the address you open in the browser.

Success: http://localhost:3000/health shows `{"ok":true}`.

## Step 3: Create and pay for an order in the demo store

Open http://localhost:3000/store in a browser (a private window helps). Pick an item and start checkout. Log in to PayPal as the sandbox **Personal** account and approve the payment. PayPal sends you back to the store, which captures the payment for you.

Success: you see a thank-you page with your order ID (`ORD-...`). Write it down. You do not need `spike:order` or `spike:capture` for new orders; they are only for experiments.

## Step 4: Open a dispute as the buyer

Log in to https://www.sandbox.paypal.com as the same Personal buyer account. Open the payment in **Activity**, choose **Report a problem**, and pick **Item not received**.

The exact sandbox menu wording may differ from this. Write down the options you actually clicked so the next person can repeat it.

Success: the sandbox shows a dispute or case for the payment.

## Step 5: Check the dispute through the API

Your dispute can reach the server in two ways: the webhook (it can take a few minutes) or a manual sync. To sync right away:

```
curl -X POST -H "x-debug-token: <YOUR_DEBUG_TOKEN>" http://localhost:3000/api/disputes/sync
```

Then list the disputes:

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

## Step 6: Check the webhook arrived

PayPal cannot reach `localhost`, so locally you will not see webhooks unless you expose your machine with a tunnel; use the sync command from step 5 instead. On the deployed Render service, check soon after opening the dispute. Events are saved in the database. Locally they survive restarts. On Render's free plan PGlite data resets on every redeploy or restart, because the plan has no persistent disk (fine for the demo). Use the `curl` command from step 7 of the deploy section below; a plain browser visit returns 401 because the endpoint needs the `x-debug-token` header, and it returns 404 if `DEBUG_TOKEN` is not set on the service.

Success: the list contains a `CUSTOMER.DISPUTE.CREATED` event for your dispute ID. If the list is empty, look in Render → Logs for a line starting `webhook received: CUSTOMER.DISPUTE.CREATED` (it ends with the dispute ID).

## If something goes wrong

- **401 / `invalid_client`**: the client ID or secret is wrong, or you mixed Live and Sandbox credentials. Re-copy both from the Sandbox tab of your REST app.
- **"Config error: ... is required"**: a variable in `.env` is missing or blank. The message names it.
- **Dispute not appearing**: run the sync command from step 5, or wait a few minutes. The sandbox can be slow. Confirm you used the same buyer account that paid.
- **No `CUSTOMER.DISPUTE.CREATED` event**: check the webhook is subscribed to dispute events in the developer dashboard and points at the deployed server URL.
- **Webhooks fail verification (400)**: expected until the real Webhook ID is set in `PAYPAL_WEBHOOK_ID` and the service is redeployed.
- **Signature `FAILURE` even with the correct Webhook ID**: tell Claude; we may need to verify using the raw request body.
- **Buyer lands on a broken page after paying**: `PUBLIC_BASE_URL` does not match the address you are using. Fix it and start again with a new order.
- Never paste secrets or tokens anywhere. Share the `debug_id` the scripts print instead.

## Deploying the webhook receiver (Render)

1. Push this repo to GitHub.
2. In Render, choose **New → Blueprint** and pick the repo. Render reads `render.yaml` and proposes the `dispute-copilot` web service.
3. In the Render dashboard, set `PUBLIC_BASE_URL` to your Render URL once you know it, add `GEMINI_API_KEY` and/or `GROQ_API_KEY`, and fill the four secret env vars: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` (use a placeholder for now) and `DEBUG_TOKEN` (any long random string you make up).
4. When the deploy finishes, copy the real `https://…onrender.com` URL from the Render dashboard (the service name may get a suffix) and use it wherever `<service>.onrender.com` appears below. Open `<that URL>/health`. Success: it shows `{"ok":true}`.
5. Go to developer.paypal.com → Apps & Credentials (Sandbox) → your app → Webhooks → **Add webhook**. Use the URL `https://<service>.onrender.com/webhooks/paypal` and subscribe to `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED` and `CUSTOMER.DISPUTE.RESOLVED`.
6. Copy the new **Webhook ID** into Render's `PAYPAL_WEBHOOK_ID` and redeploy.
7. After a dispute is opened, view the received events:

```
curl -H "x-debug-token: <your DEBUG_TOKEN>" https://<service>.onrender.com/debug/events
```

Note: free Render services sleep when idle. The first request after a while can take about a minute, and PayPal may retry the webhook in the meantime.
