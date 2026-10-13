# Runbook: create a sandbox payment and a real dispute

Goal: produce a genuine PayPal **sandbox** dispute so we can see what the Disputes API and webhooks really return. Everything here uses sandbox accounts and fake money. Run all commands from the repo root.

Never paste client secrets, tokens or full request headers into chat, issues or commits. The scripts only print IDs and statuses.

## Before you start

Run `npm install` once from the repo root before using any script below.

You need a PayPal developer account with a sandbox **Business** (merchant) account, a sandbox **Personal** (buyer) account, and a REST app created under **Sandbox** (not Live).

## Step 1: Fill in `.env`

Copy `.env.example` to `.env` in the repo root and set at least `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from your sandbox REST app. Leave `PAYPAL_BASE_URL` as the sandbox URL (`https://api-m.sandbox.paypal.com`).

Success: the file exists and is not tracked by git (`git status` does not list it).

## Step 2: Create an order

```
npm run spike:order -w server -- 25.00
```

Success: it prints an `order_id` and an `approve_url` containing `sandbox.paypal.com`. Keep both. If the amount is not a positive number with at most 2 decimals it prints usage and exits.

## Step 3: Approve the order as the buyer

Open the `approve_url` in a browser (a private window helps). Log in as the sandbox **Personal** account and approve the payment.

Success: PayPal shows a confirmation or redirects you. The order is now approved but not yet paid.

## Step 4: Capture the payment

```
npm run spike:capture -w server -- <orderId>
```

Replace `<orderId>` with the `order_id` from step 2.

Success: it prints `status: COMPLETED` and a `capture_id`.

## Step 5: Open a dispute as the buyer

Log in to https://www.sandbox.paypal.com as the same Personal buyer account. Open the payment in **Activity**, choose **Report a problem**, and pick **Item not received**.

The exact sandbox menu wording may differ from this. Write down the options you actually clicked so the next person can repeat it.

Success: the sandbox shows a dispute or case for the payment.

## Step 6: Check the dispute through the API

```
npm run spike:disputes -w server
```

Repeat every minute or two until the dispute appears.

Success: a table lists the dispute (`dispute_id`, `reason`, `status`, `amount`, `create_time`), followed by the full JSON of the newest one. The reason is expected to be `MERCHANDISE_OR_SERVICE_NOT_RECEIVED`; record the actual value. Save the JSON (with no secrets in it) for Phase 1 work.

Warning: the full JSON may contain sandbox buyer and seller names and email addresses. They are fake, but they still look like personal data. Redact them before pasting the output into chat or Discord, or committing it.

## Step 7: Check the webhook arrived

On the deployed server, open `/debug/events` (with the debug token if one is configured).

Success: the list contains a `CUSTOMER.DISPUTE.CREATED` event for your dispute ID.

## If something goes wrong

- **401 / `invalid_client`**: the client ID or secret is wrong, or you mixed Live and Sandbox credentials. Re-copy both from the Sandbox tab of your REST app.
- **"Config error: ... is required"**: a variable in `.env` is missing or blank. The message names it.
- **Dispute not appearing**: wait a few minutes. The sandbox can be slow. Confirm you used the same buyer account that paid.
- **No `CUSTOMER.DISPUTE.CREATED` event**: check the webhook is subscribed to dispute events in the developer dashboard and points at the deployed server URL.
- Never paste secrets or tokens anywhere. Share the `debug_id` the scripts print instead.

## Deploying the webhook receiver (Render)

1. Push this repo to GitHub.
2. In Render, choose **New → Blueprint** and pick the repo. Render reads `render.yaml` and proposes the `dispute-copilot` web service.
3. In the Render dashboard, fill the four secret env vars: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` (use a placeholder for now) and `DEBUG_TOKEN` (any long random string you make up).
4. When the deploy finishes, open `https://<service>.onrender.com/health`. Success: it shows `{"ok":true}`.
5. Go to developer.paypal.com → Apps & Credentials (Sandbox) → your app → Webhooks → **Add webhook**. Use the URL `https://<service>.onrender.com/webhooks/paypal` and subscribe to `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED` and `CUSTOMER.DISPUTE.RESOLVED`.
6. Copy the new **Webhook ID** into Render's `PAYPAL_WEBHOOK_ID` and redeploy.
7. After a dispute is opened, view the received events:

```
curl -H "x-debug-token: <your DEBUG_TOKEN>" https://<service>.onrender.com/debug/events
```

Note: free Render services sleep when idle. The first request after a while can take about a minute, and PayPal may retry the webhook in the meantime.
