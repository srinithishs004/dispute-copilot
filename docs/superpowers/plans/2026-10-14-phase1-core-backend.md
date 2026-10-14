# Phase 1 — Core Backend & Evidence Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new sandbox dispute automatically becomes a stored dispute linked to our order, with an evidence pack and an AI-drafted response letter, status `READY_FOR_REVIEW`.

**Architecture:** Postgres behind a tiny `Db` interface: real Postgres (`pg`) when `DATABASE_URL` is set, otherwise PGlite (Postgres in-process) — no local install needed, and tests run on in-memory PGlite. A small Postgres job table replaces pg-boss. A demo storefront creates real sandbox payments tied to our orders. Webhooks are stored and queue a `processDispute` job; the worker syncs the dispute from PayPal, builds the evidence pack in plain code, then asks the LLM (Gemini, Groq fallback) for a letter that may only cite facts from the pack.

**Tech Stack:** Node 22, TypeScript strict, Express 5, zod, Vitest, supertest, `pg`, `@electric-sql/pglite`.

**Spec:** `docs/superpowers/specs/2026-10-13-dispute-copilot-design.md` (sections 4, 6–13). Builds on Phase 0 (`docs/superpowers/plans/2026-10-13-phase0-sandbox-proof.md`).

## Global Constraints

- Node 22, ESM, TypeScript `strict: true`; imports use `.js` extensions.
- PayPal base URL is sandbox only (`https://api-m.sandbox.paypal.com`), enforced by config.
- Secrets only from env; never log tokens, secrets, request bodies, emails or full IDs. Logged IDs go through `maskId` (Task 5).
- All I/O injectable (`fetchImpl`, `sleep`, `now`, `Db`); tests never touch the network; DB tests use in-memory PGlite.
- The AI never calls PayPal. Nothing is sent to PayPal on the seller's behalf in this phase.
- Commit after every task.

## Decisions this plan makes (deviations from the spec, for review)

1. **Job queue:** a `jobs` table with `SELECT … FOR UPDATE SKIP LOCKED` instead of pg-boss (spec §5). Reason: one less dependency, works on PGlite, fully testable.
2. **Local database:** PGlite at `.data/pglite` when `DATABASE_URL` is unset. PGlite is single-process, so in that mode the worker runs inside the web process (`RUN_WORKER_INLINE`). The separate Render worker and hosted Postgres stay in Phase 3.
3. **Letter before advisor:** Phase 1 drafts the letter for a `FIGHT` stance; Phase 2's advisor passes its recommendation into the same function.

## Review Focus

1. **The same dispute arrives twice** (CREATED then UPDATED, or a redelivery) → one `disputes` row, updated in place; processing it again doesn't duplicate evidence or analyses. (Task 5 and Task 7 tests)
2. **A dispute for a payment that isn't from our store** → dispute saved with `local_state = 'NEEDS_MANUAL'` and `manual_reason = 'no matching order'`; no crash, no AI call. (Task 7 test)
3. **The AI returns malformed JSON, or a letter citing facts not in the pack** → retry once, then Groq, then `NEEDS_MANUAL`; an unvalidated letter is never stored. (Tasks 8–9 tests)
4. **The buyer cancels on PayPal, or `/store/return` is hit with a missing or unknown token** → friendly page, 400 for bad tokens, no capture call. (Task 4 tests)
5. **A job handler throws** → attempts incremented and retried with backoff; after 3 attempts the job is `failed` and the dispute is `NEEDS_MANUAL`. (Task 2 and Task 9 tests)

---

### Task 1: Database layer and schema

**Files:**
- Create: `server/src/db/db.ts`, `server/src/db/migrate.ts`, `server/src/db/migrations/001_init.sql`
- Modify: `server/src/config.ts` (+ `DATABASE_URL`, `PGLITE_DIR`), `server/package.json` (deps `pg`, `@types/pg`, `@electric-sql/pglite`), `.gitignore` (+ `.data/`), `.env.example`
- Test: `server/test/db/migrate.test.ts`, `server/test/helpers.ts` (+ `makeTestDb()`)

**Interfaces:**
- Produces: `interface Db { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; close(): Promise<void>; }`
- Produces: `createDb(opts: { databaseUrl: string | null; pgliteDir: string | null }): Promise<Db>` — `pg.Pool` when `databaseUrl` is set; PGlite at `pgliteDir` otherwise; in-memory PGlite when both are null (tests).
- Produces: `migrate(db: Db): Promise<string[]>` — applies `migrations/*.sql` in name order inside a transaction each, recorded in `schema_migrations(name text primary key, applied_at timestamptz)`; returns the names it applied.
- Produces: `Config` gains `databaseUrl: string | null`, `pgliteDir: string` (default `.data/pglite`).
- Produces (test helper): `makeTestDb(): Promise<Db>` — in-memory PGlite, migrated.

`001_init.sql` tables (spec §8, plus jobs):
- `orders(id text pk, item text, amount numeric(10,2), currency text, buyer_email text, paypal_order_id text unique, paypal_capture_id text unique, status text not null default 'PENDING', created_at timestamptz default now())`
- `shipments(id serial pk, order_id text references orders, carrier text, tracking_number text, status text, shipped_at timestamptz, delivered_at timestamptz, signature_proof boolean default false)`
- `messages(id serial pk, order_id text references orders, sender text check (sender in ('buyer','seller')), body text, sent_at timestamptz)`
- `store_policy(id int pk default 1 check (id = 1), refund_window_days int, policy_text text)`
- `webhook_events(paypal_event_id text pk, event_type text, resource_id text, raw jsonb, received_at timestamptz default now(), processed_at timestamptz)`
- `disputes(paypal_dispute_id text pk, order_id text references orders, reason text, status text, stage text, amount numeric(10,2), currency text, response_due_at timestamptz, raw jsonb, local_state text not null default 'NEW', manual_reason text, updated_at timestamptz default now())`
- `evidence_items(id serial pk, dispute_id text references disputes, type text, description text, file_path text)`
- `analyses(id serial pk, dispute_id text references disputes, recommendation text, confidence int, evidence_strength text, reasons jsonb, missing_evidence jsonb, suggested_offer numeric(10,2), letter_draft text, model_used text, created_at timestamptz default now())`
- `actions(id serial pk, dispute_id text references disputes, type text, payload jsonb, state text, paypal_response jsonb, error text, approved_at timestamptz, sent_at timestamptz)`
- `jobs(id bigserial pk, type text not null, payload jsonb not null, state text not null default 'queued' check (state in ('queued','running','done','failed')), attempts int not null default 0, run_at timestamptz not null default now(), last_error text, created_at timestamptz default now(), updated_at timestamptz default now())` + index on `(state, run_at)`

- [ ] **Step 1: Write failing tests** — `migrate` on a fresh DB returns `['001_init.sql']` and every table above exists (query `information_schema.tables`); a second `migrate` returns `[]`; `loadConfig` defaults `pgliteDir` to `.data/pglite` and `databaseUrl` to `null`.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** `createDb`, `migrate`, the SQL, and config changes. Resolve the migrations folder relative to `import.meta.url`; add a `postbuild` copy of `src/db/migrations` to `dist/db/migrations` (plain `node -e` fs copy, no new dependency).
- [ ] **Step 4: Run all tests and `npm run build` — expect PASS; check `dist/db/migrations/001_init.sql` exists**
- [ ] **Step 5: Commit** — `feat: Postgres/PGlite database layer and initial schema`

---

### Task 2: Job queue and worker loop

**Files:**
- Create: `server/src/jobs/queue.ts`, `server/src/jobs/worker.ts`
- Test: `server/test/jobs/queue.test.ts`, `server/test/jobs/worker.test.ts`

**Interfaces:**
- Consumes: `Db`
- Produces:
  - `type Job = { id: number; type: string; payload: unknown; attempts: number }`
  - `enqueue(db, type: string, payload: unknown, opts?: { runAt?: Date }): Promise<number>`
  - `claimNext(db, now: Date): Promise<Job | null>` — atomically moves the oldest due `queued` job to `running` and increments `attempts` (`UPDATE jobs … WHERE id = (SELECT id … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING …`).
  - `completeJob(db, id): Promise<void>`
  - `failJob(db, job: Job, err: Error, now: Date): Promise<'retry' | 'failed'>` — `MAX_ATTEMPTS = 3`; retry sets `state='queued'`, `run_at = now + attempts * 30s`, `last_error = err.name + ': ' + err.message` truncated to 500 chars.
  - `type JobHandler = (job: Job) => Promise<void>`
  - `runWorkerOnce(deps: { db: Db; handlers: Record<string, JobHandler>; now: () => Date; logger }): Promise<boolean>` — claims and runs one job; returns false when nothing is due. An unknown type fails the job permanently.
  - `startWorker(deps & { sleep: (ms) => Promise<void>; idleMs?: number; signal: AbortSignal }): Promise<void>` — loops `runWorkerOnce`, sleeping `idleMs` (default 1000) when idle, until `signal` aborts.

- [ ] **Step 1: Write failing tests**
  - enqueue then claim returns the job with `attempts: 1`; a second claim returns `null`
  - a job with a future `runAt` isn't claimed until `now` passes it
  - `failJob` on attempt 1 → `'retry'` with `run_at` 30s later; on attempt 3 → `'failed'`
  - `runWorkerOnce` runs the matching handler then marks it `done`; a throwing handler → job back to `queued`; an unknown type → `failed`
  - `startWorker` stops when the signal aborts (fake `sleep`)
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** — `feat: Postgres-backed job queue and worker loop`

---

### Task 3: Mock store data

**Files:**
- Create: `server/src/store/seed.ts`, `server/src/store/repo.ts`
- Test: `server/test/store/repo.test.ts`

**Interfaces:**
- Consumes: `Db`
- Produces:
  - `seedStore(db): Promise<void>` — idempotent (`ON CONFLICT DO NOTHING`); inserts the policy and 12 historic demo orders with ids `DEMO-HIST-01` … `DEMO-HIST-12`
  - `type OrderBundle = { order: OrderRow; shipments: ShipmentRow[]; messages: MessageRow[]; policy: PolicyRow }` (row types mirror the Task 1 columns, camelCase)
  - `findOrderBundle(db, orderId: string): Promise<OrderBundle | null>`
  - `findOrderByCaptureId(db, captureId: string): Promise<OrderRow | null>`
  - `PRODUCTS: { id: string; name: string; price: string }[]` — exactly three: `mug` "Ceramic Mug" `18.00`, `tee` "Logo T-Shirt" `25.00`, `lamp` "Desk Lamp" `49.00`

Seed mix (fixed, so later demos and tests are repeatable): policy `refund_window_days = 30`, text "Returns accepted within 30 days of delivery. Item must be unused."
- 01–04 strong "not received" defences: shipped with a carrier and tracking number, delivered, 02 and 04 with `signature_proof`
- 05–06 weak: shipped with tracking but status `in_transit`, no delivery date
- 07 no shipment record at all
- 08–09 "not as described" with buyer messages complaining and the seller replying with a photo offer
- 10 delivered, buyer message 45 days after delivery (outside the refund window)
- 11 friendly buyer message saying "it arrived, thanks!" then a dispute later
- 12 delivered and signed, plus an angry buyer message

- [ ] **Step 1: Write failing tests** — after seeding twice there are exactly 12 orders and 1 policy row; `findOrderBundle('DEMO-HIST-02')` has 1 delivered shipment with `signatureProof: true`; `DEMO-HIST-07` has `shipments: []`; an unknown id → `null`; `findOrderByCaptureId` finds an order after its `paypal_capture_id` is set.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement.** Seeded emails use `@example.com`.
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** — `feat: seeded mock store with repeatable dispute scenarios`

---

### Task 4: Demo storefront with PayPal Checkout

**Files:**
- Create: `server/src/routes/store.ts`, `server/src/store/pages.ts` (HTML strings)
- Modify: `server/src/paypal/orders.ts` (optional `requestId` → `PayPal-Request-Id` header on create and capture), `server/src/app.ts` (mount, `express.urlencoded`), `server/src/config.ts` (+ `PUBLIC_BASE_URL`, default `http://localhost:3000`)
- Test: `server/test/routes/store.test.ts`, `server/test/paypal/orders.test.ts` (request-id cases)

**Interfaces:**
- Consumes: `Db`, `PRODUCTS`, `createOrder`, `captureOrder`, `PayPalClient`
- Produces routes:
  - `GET /store` → HTML listing `PRODUCTS`, each with a "Buy with PayPal" form posting `productId`
  - `POST /store/checkout` → unknown product → 400 page. Otherwise insert `orders` row (id `ORD-` + 8 uppercase base36 chars, status `PENDING`), `createOrder` with `invoiceId` = order id, `returnUrl` `${publicBaseUrl}/store/return`, `cancelUrl` `${publicBaseUrl}/store/cancel`, `requestId` = `create-${orderId}`; save `paypal_order_id`; `303` redirect to `approveUrl`
  - `GET /store/return?token=<paypal order id>` → missing token or no matching order → 400 page with no PayPal call. Otherwise `captureOrder` (`requestId` = `capture-${orderId}`), save `paypal_capture_id`, status `PAID`, insert a shipment (`carrier 'USPS'`, tracking `9400` + 18 digits derived from the order id, status `in_transit`, `shipped_at` now) and render a thank-you page with the order id. An already-`PAID` order renders the thank-you without capturing again.
  - `GET /store/cancel` → friendly "Payment cancelled — nothing was charged" page
- Produces: `createOrder(..., input & { requestId?: string })`, `captureOrder(c, orderId, opts?: { requestId?: string })`

Pages are plain server-rendered HTML with inline CSS. All dynamic values are escaped with a small `escapeHtml` in `pages.ts`.

- [ ] **Step 1: Write failing tests** (fake PayPal client + `makeTestDb`) — checkout redirects 303 to the fake approve URL and stores the PayPal order id with `invoice_id` = our order id; a bad product → 400; return captures once and marks the order PAID with a shipment; a second return → no second capture; a missing or unknown token → 400 with the fake client never called; cancel → 200 page; `requestId` sends a `PayPal-Request-Id` header.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all tests — expect PASS**
- [ ] **Step 5: Commit** — `feat: demo storefront paying through PayPal sandbox checkout`

---

### Task 5: Webhook events stored in Postgres and queued

**Files:**
- Modify: `server/src/routes/webhooks.ts`, `server/src/app.ts` (`AppDeps` gets `db: Db`; `eventLog` removed), `server/test/helpers.ts`, `server/test/webhooks.test.ts`
- Delete: `server/src/webhooks/eventLog.ts` and its test cases
- Create: `server/src/log.ts`

**Interfaces:**
- Consumes: `Db`, `enqueue`
- Produces: `maskId(id: string | null | undefined): string` — `'-'` for empty; ids of 8 characters or fewer → `'****'`; otherwise first 4 + `'…'` + last 4
- Produces: `disputeIdFromEvent(event: unknown): string | null` — `resource.dispute_id` if it's a string, else `resource.id` if `event_type` starts with `CUSTOMER.DISPUTE.`, else `null`
- Behaviour change: a verified event is inserted into `webhook_events` (`ON CONFLICT (paypal_event_id) DO NOTHING`). Only when the row is new and `disputeIdFromEvent` returns an id, enqueue `processDispute` with `{ disputeId }`. The log line becomes `webhook received: <event_type> <maskId(disputeId)>` (or `duplicate`). `GET /debug/events` reads the newest 50 from `webhook_events` (same token rules). All other Phase 0 webhook behaviour and tests stay.
- Produces: `POST /api/disputes/sync` (debug-token protected): `listDisputes` (page size 20) and enqueue `processDispute` for each → `{ queued: n }`. This is the fallback when webhooks are slow (spec §15).

- [ ] **Step 1: Update and add failing tests** — a verified dispute event creates 1 `webhook_events` row and 1 `processDispute` job; a duplicate creates neither again; a non-dispute event is stored but no job; `maskId('PP-D-12345678')` → `'PP-D…5678'`; the logged line contains no full id; `/debug/events` returns DB rows; sync enqueues one job per listed dispute and needs the token.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all tests — expect PASS**
- [ ] **Step 5: Commit** — `feat: persist webhook events and queue dispute processing`

---

### Task 6: PayPal client hardening

**Files:**
- Modify: `server/src/paypal/client.ts`
- Test: `server/test/paypal/client.test.ts`

**Interfaces (unchanged signatures):** `createPayPalClient` gains optional `timeoutMs` (default 10000).

Behaviour:
- Every fetch, the token call included, gets `signal: AbortSignal.timeout(timeoutMs)`.
- A network error or timeout counts like a 5xx: retried within the same 3-attempt budget with the same 500/1000 ms backoff; after the last attempt it throws `PayPalError` with status `0`, name `NETWORK_ERROR`, and the original error's `name` in the message.
- The token call uses the same retry policy.
- Concurrent requests share one in-flight token fetch.
- A 401 clears the token only if it's still the token that request used.
- A 429 with `Retry-After: <seconds>` waits `min(seconds, 5) * 1000` ms instead of the fixed backoff.

- [ ] **Step 1: Write failing tests** — a network throw then 200 → succeeds after one 500 ms sleep; 3 throws → `PayPalError` status 0 `NETWORK_ERROR`; the token endpoint 503 then 200 → succeeds; two concurrent requests with no cached token → 1 token call; 429 with `Retry-After: 2` → sleep 2000; `Retry-After: 60` → sleep 5000; the fetch init has a `signal`.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all tests — expect PASS**
- [ ] **Step 5: Commit** — `fix: PayPal client timeouts, network retries and shared token fetch`

---

### Task 7: Dispute sync and evidence builder

**Files:**
- Create: `server/src/disputes/repo.ts`, `server/src/agent/evidence.ts`, `server/src/jobs/processDispute.ts`
- Test: `server/test/agent/evidence.test.ts`, `server/test/jobs/processDispute.test.ts`, `server/test/fixtures/dispute-inr.json`

**Interfaces:**
- Consumes: `getDispute`, `Db`, `findOrderBundle`, `findOrderByCaptureId`, `enqueue`
- Produces:
  - `upsertDispute(db, detail: DisputeDetail, orderId: string | null): Promise<void>`. It maps:
    - `reason` and `status`
    - `dispute_life_cycle_stage` → `stage`
    - `dispute_amount.value` / `currency_code` → `amount` / `currency`
    - `seller_response_due_date` → `response_due_at`
    - the full object → `raw`
    
    It never moves `local_state` backwards from `READY_FOR_REVIEW` or later.
  - `setLocalState(db, disputeId, state: LocalState, manualReason?: string)`; `type LocalState = 'NEW'|'ANALYZING'|'READY_FOR_REVIEW'|'ACTION_PENDING'|'ACTION_SENT'|'RESOLVED'|'NEEDS_MANUAL'`
  - `matchOrderId(db, detail): Promise<string | null>` — first `disputed_transactions[*].invoice_number` that exists in `orders`, else `seller_transaction_id` matched against `orders.paypal_capture_id`
  - `type EvidencePack = { disputeId: string; reason: string; amount: string; currency: string; facts: Fact[]; checklist: { requirement: string; present: boolean }[]; missing: string[] }`
  - `type Fact = { id: string; label: string; value: string }` — ids like `order.id`, `shipment.0.tracking`, `shipment.0.delivered_at`, `message.2`, `policy.text`
  - `buildEvidencePack(detail: DisputeDetail, bundle: OrderBundle): EvidencePack` — pure; requirements per reason:
    - `MERCHANDISE_OR_SERVICE_NOT_RECEIVED` → "tracking number", "delivery confirmation", "signature on delivery"
    - `MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED` → "item description", "buyer communication", "refund policy"
    - anything else → "order record", "buyer communication"
  - `processDispute(deps: { db; paypal; now }): JobHandler` — `getDispute` → `matchOrderId` → `upsertDispute`.
    - No order → `NEEDS_MANUAL` "no matching order", done.
    - Otherwise `ANALYZING` → `buildEvidencePack` → replace the dispute's `evidence_items` (delete + insert, so a rerun is idempotent) → enqueue `draftLetter` `{ disputeId }`.

Field names come from the PayPal Disputes API reference. The fixture is a realistic "item not received" dispute using them. **If the Phase 0 sandbox run shows different names, update the fixture and mapping first and note it in the spec's "Phase 0 findings".**

- [ ] **Step 1: Write failing tests**
  - Evidence: for `DEMO-HIST-02` and an INR dispute, all three requirements are present and `missing` is `[]`; for `DEMO-HIST-07`, missing includes "tracking number" and "delivery confirmation"; every fact id is unique.
  - Job: an INR fixture whose `invoice_number` = `DEMO-HIST-02` → 1 dispute row linked, evidence items stored, state `ANALYZING`, 1 `draftLetter` job. Running it again leaves the same evidence row count, and does not add a second `draftLetter` job while one for that dispute is `queued` or `running` (match on `payload->>'disputeId'`). A fixture with an unknown invoice and capture → `NEEDS_MANUAL`, no `draftLetter` job. A dispute already `READY_FOR_REVIEW` and synced again keeps that state.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all tests — expect PASS**
- [ ] **Step 5: Commit** — `feat: sync disputes from PayPal and build evidence packs`

---

### Task 8: LLM wrapper (Gemini first, Groq fallback)

**Files:**
- Create: `server/src/ai/llm.ts`
- Modify: `server/src/config.ts` (+ `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`; all optional), `.env.example`
- Test: `server/test/ai/llm.test.ts`

**Interfaces:**
- Produces:
  - `class LlmUnavailableError extends Error`
  - `createLlm(opts: { gemini: { apiKey: string | null; model: string }; groq: { apiKey: string | null; model: string }; fetchImpl?: typeof fetch; timeoutMs?: number }): Llm`
  - `type Llm = { generateJson<T>(prompt: { system: string; user: string }, schema: z.ZodType<T>): Promise<{ data: T; model: string }> }`
- Config defaults: `GEMINI_MODEL` = `gemini-3.6-flash`, `GROQ_MODEL` = `llama-3.3-70b-versatile`.

Gemini call:
- `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- header `x-goog-api-key`
- body `{ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }`
- read `candidates[0].content.parts[0].text`

Groq call:
- `POST https://api.groq.com/openai/v1/chat/completions`
- header `Authorization: Bearer`
- body `{ model, messages: [{role:'system'},{role:'user'}], response_format: { type: 'json_object' }, temperature: 0.2 }`
- read `choices[0].message.content`

Order of attempts:
1. Gemini.
2. On invalid JSON or a schema failure, Gemini once more with the validation error appended to the user prompt.
3. Groq, once.
4. Throw `LlmUnavailableError`.

A provider with no key is skipped, and HTTP or network errors move straight to the next provider. `model` in the result is `gemini:<model>` or `groq:<model>`. Never log prompts, responses or keys.

- [ ] **Step 1: Write failing tests** (fake fetch)
  - Valid Gemini JSON → data, model `gemini:…`.
  - Invalid JSON then valid → 2 Gemini calls, and the second prompt contains the error.
  - Gemini invalid twice → Groq used.
  - Gemini HTTP 500 → Groq immediately.
  - No Gemini key → Groq only.
  - Both fail or have no keys → `LlmUnavailableError`.
  - The Gemini request has `x-goog-api-key` and `responseMimeType`.
  - The Groq request has `response_format`.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** — `feat: LLM wrapper with Gemini primary and Groq fallback`

---

### Task 9: Letter drafter, draftLetter job, worker wiring and dispute API

**Files:**
- Create: `server/src/agent/letter.ts`, `server/src/jobs/draftLetter.ts`, `server/src/jobs/handlers.ts`, `server/src/routes/disputes.ts`
- Modify: `server/src/index.ts` (create the DB, migrate, seed, start the inline worker), `server/src/config.ts` (+ `RUN_WORKER_INLINE`, default `true` when `DATABASE_URL` is unset, else `false`), `server/src/app.ts`
- Test: `server/test/agent/letter.test.ts`, `server/test/jobs/draftLetter.test.ts`, `server/test/routes/disputes.test.ts`, `server/test/e2e/dispute-flow.test.ts`

**Interfaces:**
- Consumes: `Llm`, `EvidencePack`, `Db`, job queue, `processDispute`
- Produces:
  - `type LetterDraft = { letter: string; citedFactIds: string[] }`
  - `draftLetter(llm: Llm, pack: EvidencePack, stance: 'FIGHT' | 'OFFER' | 'ACCEPT' = 'FIGHT'): Promise<{ draft: LetterDraft; model: string }>`
    - Prompt: the facts as `[id] label: value` lines. Rules:
      - use only the listed facts and cite their ids
      - no invented tracking numbers, dates or promises
      - under 200 words
      - polite and factual
      - addressed to PayPal's dispute team
    - Validation after the zod schema:
      - every `citedFactIds` entry exists in the pack and there is at least 1
      - `letter` is 40–1500 characters
      - every digit run of 6 or more in the letter appears in some fact value
    - A failed check throws `LetterRejectedError` (the job treats it like an AI failure).
  - `draftLetterJob(deps: { db; llm }): JobHandler`:
    - Load the dispute and its order bundle, rebuild the pack, and call `draftLetter`.
    - Insert an `analyses` row (`recommendation 'FIGHT'`, `letter_draft`, `model_used`) and set `READY_FOR_REVIEW`.
    - On `LlmUnavailableError` or `LetterRejectedError` on the job's final attempt, set `NEEDS_MANUAL` with reason `'AI draft unavailable'` and let the job end `failed`.
    - On earlier attempts, rethrow so the queue retries.
  - `buildHandlers(deps): Record<string, JobHandler>` — `{ processDispute, draftLetter }`
  - Routes (debug-token protected until the Phase 3 UI):
    - `GET /api/disputes` → `[{ disputeId, reason, status, amount, currency, responseDueAt, localState }]` newest first
    - `GET /api/disputes/:id` → that plus `evidence` (pack), `latestAnalysis`, `manualReason`; 404 if unknown
  - `index.ts` startup order: `loadConfig` → `createDb` → `migrate` → `seedStore` → `createApp` → listen → if `runWorkerInline`, `startWorker` with an `AbortController` aborted on SIGTERM/SIGINT, then `db.close()`.

- [ ] **Step 1: Write failing tests**
  - Letter: a valid fake-LLM draft passes; a draft citing an unknown fact id → `LetterRejectedError`; a draft containing tracking `999999999` not in the pack → rejected.
  - Job: success → `analyses` row and `READY_FOR_REVIEW`; `LlmUnavailableError` on attempt 1 → rethrows and the state is unchanged; on attempt 3 → `NEEDS_MANUAL`.
  - Routes: 401 without the token; list and detail shapes; 404.
  - E2E (fake PayPal + fake LLM + in-memory DB): seed → POST a verified `CUSTOMER.DISPUTE.CREATED` webhook for a dispute whose `invoice_number` is `DEMO-HIST-02` → `runWorkerOnce` until idle → `GET /api/disputes/:id` shows `READY_FOR_REVIEW`, evidence with no missing items, and a letter.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all tests, `npm run build`, `npm run typecheck:scripts -w server` — expect PASS**
- [ ] **Step 5: Manual smoke (no network needed):** start with `PGLITE_DIR=/tmp/dc-smoke PAYPAL_CLIENT_ID=x PAYPAL_CLIENT_SECRET=y npm start`, then:
  - `GET /health` → ok
  - `GET /store` → 3 products
  - stop with Ctrl-C → clean exit, no stack trace
- [ ] **Step 6: Commit** — `feat: AI letter drafts, worker wiring and dispute API`

---

### Task 10: Docs, runbook and spec update

**Files:**
- Modify: `README.md` (how it works now; the new env vars; `npm run dev` starts web + inline worker), `docs/runbooks/sandbox-dispute.md` (use `/store` instead of `spike:order` for new orders; check `/api/disputes/<id>` with the token), `docs/superpowers/specs/2026-10-13-dispute-copilot-design.md` (record decisions 1–3 above in §5/§6/§9 and the masking rule in §12)

- [ ] **Step 1: Update the three documents** — plain English for a junior developer; no secrets; exact commands from the repo root.
- [ ] **Step 2: Commit** — `docs: Phase 1 setup, runbook and spec decisions`

**Milestone check (Asana "New dispute auto-produces evidence pack + draft"):** the Task 9 E2E test passes, and in a real local sandbox run a dispute opened on a `/store` order reaches `READY_FOR_REVIEW` with a letter.
