# Phase 0 — Sandbox Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the risky part works: a sandbox buyer pays, opens a dispute, our server receives the verified webhook, and our code reads the dispute back from the PayPal API.

**Architecture:** An npm-workspaces repo with one `server` package (Express 5, TypeScript, ESM). A small injectable PayPal client handles OAuth and retries; thin `orders` and `disputes` modules sit on top of it. A webhook route verifies events with PayPal and keeps them in memory (the database arrives in Phase 1). Spike scripts drive the manual sandbox test.

**Tech Stack:** Node 22, TypeScript (strict), Express 5, zod, Vitest, supertest, tsx.

**Spec:** `docs/superpowers/specs/2026-10-13-dispute-copilot-design.md` (sections 6, 7, 10, 11, 12, 15)

## Global Constraints

- Node 22, `"type": "module"`, TypeScript `strict: true`.
- PayPal base URL is sandbox only: `https://api-m.sandbox.paypal.com`.
- Secrets only from environment variables; `.env` is git-ignored; never log tokens, secrets or full request headers.
- Use the global `fetch` (no axios). Every module that does I/O takes `fetchImpl`, `sleep` and `now` as injectable dependencies so tests never touch the network.
- Repo is MIT-licensed (`LICENSE` at root, holder "Sri Nithish S", year 2026).
- Commit after every task; git author is already configured in the repo.

## Review Focus

1. **Missing env var at startup** → process exits with an error naming the missing variable, not a stack trace about `undefined`. (Task 1 test)
2. **Access token expires during a long session** → client fetches a new token instead of sending a stale one. (Task 2 test)
3. **PayPal rejects a cached token with 401** → client clears the cache, gets a fresh token and retries once. (Task 2 test)
4. **PayPal returns a non-JSON error body (HTML 502 page)** → `PayPalError` with the status and text, no JSON parse crash. (Task 2 test)
5. **Webhook arrives without PayPal's transmission headers** (a random POST from the internet) → 400, nothing recorded, PayPal's verify API is not called. (Task 4 test)

---

### Task 1: Workspace scaffold, config and health route

**Files:**
- Create: `package.json` (root, workspaces `["server"]`, scripts `test`, `build`, `dev` forwarding to `-w server`)
- Create: `LICENSE`, `.env.example`, `README.md` (one paragraph + "Run locally" steps)
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`
- Create: `server/src/config.ts`, `server/src/app.ts`, `server/src/index.ts`
- Test: `server/test/config.test.ts`, `server/test/health.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config` where `Config = { port: number; paypal: { clientId: string; clientSecret: string; baseUrl: string; webhookId: string | null }; debugToken: string | null }`
- Produces: `createApp(deps: AppDeps): express.Express`. `AppDeps` starts as `{ config: Config }`; Task 4 adds fields.

`.env.example` keys: `PORT=3000`, `PAYPAL_CLIENT_ID=`, `PAYPAL_CLIENT_SECRET=`, `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`, `PAYPAL_WEBHOOK_ID=`, `DEBUG_TOKEN=`.

- [ ] **Step 1: Write the failing tests**

```ts
// config.test.ts
test('loads required values and defaults', () => {
  const c = loadConfig({ PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'sec' });
  expect(c.port).toBe(3000);
  expect(c.paypal.baseUrl).toBe('https://api-m.sandbox.paypal.com');
  expect(c.paypal.webhookId).toBeNull();
});
test('names the missing variable', () => {
  expect(() => loadConfig({ PAYPAL_CLIENT_ID: 'id' })).toThrow(/PAYPAL_CLIENT_SECRET/);
});
// health.test.ts
test('GET /health returns ok', async () => {
  const res = await request(createApp({ config: testConfig })).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run `npm test` — expect FAIL (modules not found)**
- [ ] **Step 3: Implement `loadConfig` with zod** (empty strings count as missing for required keys; optional ones become `null`) **and `createApp` with `express.json()` and `/health`.** `index.ts` calls `loadConfig(process.env)`, prints the error message and `process.exit(1)` on failure, else listens on `config.port`. Load `.env` locally with `node --env-file=.env` in the `dev` script (`tsx watch --env-file=.env src/index.ts`).
- [ ] **Step 4: Run `npm test` — expect PASS; run `npm run build` — expect no errors**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: scaffold server workspace with config and health route"`

---

### Task 2: PayPal client (OAuth + retries + errors)

**Files:**
- Create: `server/src/paypal/client.ts`
- Test: `server/test/paypal/client.test.ts`

**Interfaces:**
- Consumes: `Config['paypal']`
- Produces:
  - `class PayPalError extends Error { status: number; name: string; debugId: string | null; body: unknown }`
  - `createPayPalClient(opts: { clientId: string; clientSecret: string; baseUrl: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number }): PayPalClient`
  - `PayPalClient = { request<T>(method: 'GET'|'POST'|'PATCH', path: string, body?: unknown, headers?: Record<string,string>): Promise<T> }`

Behaviour pinned by the spec (section 11): token from `POST /v1/oauth2/token` (Basic auth, `grant_type=client_credentials`), cached until `expires_in - 60` seconds; retry 429 and 5xx up to 3 attempts total with backoff 500 ms then 1000 ms; no retry on other 4xx; on 401 clear token and retry once.

- [ ] **Step 1: Write the failing tests** (fake `fetchImpl` returning queued `Response` objects; `sleep` records delays)

```ts
test('caches the token across requests', ...)            // 2 requests → 1 token call
test('refreshes the token after expiry', ...)            // now() advanced past expires_in-60 → 2 token calls
test('on 401 refreshes token and retries once', ...)     // 401 then 200 → result returned, 2 token calls
test('retries 503 with 500ms then 1000ms backoff', ...)  // 503,503,200 → sleep calls [500,1000]
test('gives up after 3 attempts', ...)                   // 503 x3 → rejects PayPalError status 503
test('does not retry 422', ...)                          // 422 → 1 call, PayPalError.name from body.name, debugId from body.debug_id
test('handles non-JSON error body', ...)                 // 502 text/html x3 → PayPalError status 502, body is the text
```

- [ ] **Step 2: Run `npm test -- client` — expect FAIL**
- [ ] **Step 3: Implement `createPayPalClient`.** Parse the body as JSON only when `content-type` includes `application/json`; otherwise keep text. Never include the token in error messages.
- [ ] **Step 4: Run `npm test -- client` — expect PASS**
- [ ] **Step 5: Commit** — `git commit -am "feat: PayPal client with token cache, retries and typed errors"` (add new files first)

---

### Task 3: Orders and disputes modules

**Files:**
- Create: `server/src/paypal/orders.ts`, `server/src/paypal/disputes.ts`
- Test: `server/test/paypal/orders.test.ts`, `server/test/paypal/disputes.test.ts`

**Interfaces:**
- Consumes: `PayPalClient`
- Produces:
  - `createOrder(c: PayPalClient, input: { invoiceId: string; amount: string; currency: 'USD'; description: string }): Promise<{ id: string; approveUrl: string }>` → `POST /v2/checkout/orders`, `intent: 'CAPTURE'`, one purchase unit with `invoice_id`, `amount.value`, `description`; `approveUrl` is the link with `rel === 'payer-action'` or `'approve'`.
  - `captureOrder(c, orderId: string): Promise<{ status: string; captureId: string }>` → `POST /v2/checkout/orders/{id}/capture`, `captureId` from `purchase_units[0].payments.captures[0].id`.
  - `listDisputes(c, opts?: { pageSize?: number }): Promise<DisputeSummary[]>` → `GET /v1/customer/disputes?page_size={n}` (default 10), returns `items ?? []`.
  - `getDispute(c, id: string): Promise<DisputeDetail>` → `GET /v1/customer/disputes/{id}`.
  - `DisputeSummary = { dispute_id: string; reason: string; status: string; dispute_amount?: { currency_code: string; value: string }; create_time: string }`; `DisputeDetail = DisputeSummary & Record<string, unknown>` (tightened in Phase 1 after the spike shows real payloads).

- [ ] **Step 1: Write the failing tests** using a fake `PayPalClient` that records `(method, path, body)`:

```ts
test('createOrder sends invoice_id and returns approve link', ...) // asserts body.purchase_units[0].invoice_id === 'DEMO-1'
test('captureOrder returns capture id', ...)
test('listDisputes defaults page_size=10 and handles missing items', ...) // {} → []
test('getDispute calls the detail path', ...)                      // path === '/v1/customer/disputes/PP-D-1'
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement the four functions** (plain functions taking the client first; no classes).
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** — `"feat: orders and disputes API modules"`

---

### Task 4: Webhook route with verification, de-duplication and debug view

**Files:**
- Create: `server/src/paypal/webhooks.ts`, `server/src/webhooks/eventLog.ts`, `server/src/routes/webhooks.ts`
- Modify: `server/src/app.ts` (mount routes; extend `AppDeps`)
- Test: `server/test/webhooks.test.ts`

**Interfaces:**
- Consumes: `PayPalClient`, `Config`
- Produces:
  - `verifyWebhook(c: PayPalClient, webhookId: string, headers: Record<string, string | undefined>, event: unknown): Promise<boolean>` → `POST /v1/notifications/verify-webhook-signature` with `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, `transmission_time` (from headers `paypal-auth-algo`, `paypal-cert-url`, `paypal-transmission-id`, `paypal-transmission-sig`, `paypal-transmission-time`), `webhook_id`, `webhook_event`; true only if `verification_status === 'SUCCESS'`. Throws `MissingHeadersError` if any of the five headers is absent (no API call).
  - `createEventLog(max = 50): { add(e: StoredEvent): boolean; list(): StoredEvent[] }` — `add` returns false for a duplicate `id`; oldest dropped past `max`.
  - `StoredEvent = { id: string; eventType: string; resourceId: string | null; receivedAt: string; raw: unknown }`
  - `AppDeps` becomes `{ config: Config; paypal: PayPalClient; eventLog: EventLog; logger?: Pick<Console,'info'|'warn'> }`
  - Routes: `POST /webhooks/paypal`, `GET /debug/events` (requires header `x-debug-token` equal to `config.debugToken`; 404 if `debugToken` is null)

- [ ] **Step 1: Write the failing tests** (fake PayPal client answering the verify call)

```ts
test('verified event → 200 and recorded', ...)
test('verification FAILURE → 400 and not recorded', ...)
test('missing transmission headers → 400, verify API not called', ...)
test('same event id twice → 200 both times, recorded once', ...)
test('webhookId not configured → 503 with message "PAYPAL_WEBHOOK_ID not set"', ...)
test('/debug/events without token → 401; with token → list', ...)
test('/debug/events when DEBUG_TOKEN unset → 404', ...)
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement.** Log only `event_type` and `resource.id` (spec section 12). If PayPal's verify call itself throws, respond 500 so PayPal redelivers.
- [ ] **Step 4: Run all tests — expect PASS**
- [ ] **Step 5: Commit** — `"feat: verified PayPal webhook intake with dedupe and debug view"`

---

### Task 5: Spike scripts and manual sandbox run

**Files:**
- Create: `server/scripts/order.ts`, `server/scripts/capture.ts`, `server/scripts/disputes.ts`
- Modify: `server/package.json` (scripts `spike:order`, `spike:capture`, `spike:disputes` run with `tsx --env-file=../.env`)
- Create: `docs/runbooks/sandbox-dispute.md`

**Interfaces:**
- Consumes: `loadConfig`, `createPayPalClient`, `createOrder`, `captureOrder`, `listDisputes`, `getDispute`

Scripts are thin wrappers (no tests): `spike:order -- 25.00` creates an order with `invoiceId = DEMO-<Date.now()>` and prints the order ID and approve URL; `spike:capture -- <orderId>` prints status and capture ID; `spike:disputes` prints a table of the 10 newest disputes and the full JSON of the newest one. Scripts print IDs and statuses only — never tokens.

- [ ] **Step 1: Write the runbook** `docs/runbooks/sandbox-dispute.md` with these steps: (1) fill `.env`; (2) `npm run spike:order -- 25.00`; (3) open the approve URL, log in as the sandbox **Personal** account, approve; (4) `npm run spike:capture -- <orderId>`; (5) log in to sandbox.paypal.com as the same buyer, open the payment in Activity, report a problem → "item not received"; (6) `npm run spike:disputes` until the dispute shows; (7) check `/debug/events` on the deployed server for `CUSTOMER.DISPUTE.CREATED`.
- [ ] **Step 2: Implement the three scripts.**
- [ ] **Step 3: Run `npm run spike:order -- 25.00`** — expect an order ID and an approve URL containing `sandbox.paypal.com`.
- [ ] **Step 4: Sri runs runbook steps 3–6** — expect `spike:disputes` to list a dispute with reason `MERCHANDISE_OR_SERVICE_NOT_RECEIVED` (or the actual value shown).
- [ ] **Step 5: Commit** — `"feat: sandbox spike scripts and dispute runbook"`

---

### Task 6: Deploy webhook receiver to Render and record findings

**Files:**
- Create: `render.yaml` (one web service only for now: build `npm ci && npm run build`, start `npm start -w server`, health check `/health`, env vars `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `DEBUG_TOKEN` marked `sync: false`)
- Modify: `docs/superpowers/specs/2026-10-13-dispute-copilot-design.md` (append "Phase 0 findings" under section 10)

Prerequisites (Sri): GitHub repo created and this repo pushed; Render account linked to GitHub.

- [ ] **Step 1: Write `render.yaml`; validate with `npx -y @render/cli blueprints validate` if available, otherwise check in the Render dashboard on import.**
- [ ] **Step 2: Sri pushes to GitHub and creates the Blueprint in Render; sets the secret env vars in the dashboard.** Expect `https://<service>.onrender.com/health` → `{"ok":true}`.
- [ ] **Step 3: In the PayPal developer dashboard, add a webhook on the sandbox app** pointing to `https://<service>.onrender.com/webhooks/paypal`, subscribed to the `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, `CUSTOMER.DISPUTE.RESOLVED` events; copy its Webhook ID into Render's `PAYPAL_WEBHOOK_ID`.
- [ ] **Step 4: Run the full runbook again** — expect `/debug/events` (with `x-debug-token`) to show a `CUSTOMER.DISPUTE.CREATED` event whose `resourceId` matches the dispute ID from `spike:disputes`.
- [ ] **Step 5: Record findings in the spec** — real values seen for `status`, `reason`, `dispute_life_cycle_stage`, the response-due-date field name, the field linking to our `invoice_id`, webhook delay, and how the dispute was opened. Mask IDs.
- [ ] **Step 6: Commit** — `"chore: Render blueprint and Phase 0 sandbox findings"`

**Milestone check (Asana "Sandbox dispute flow proven"):** a sandbox dispute exists, its verified webhook was received on Render, and `getDispute` returns its details.
