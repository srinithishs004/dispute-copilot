# Phase 2: Advisor and Approved Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Phase 1 evidence pack into a recommendation (FIGHT / OFFER / ACCEPT) with reasons and a stance-matched draft, and let the seller approve it so the matching PayPal Disputes API action is sent, then show the outcome after a sandbox settle.

**Architecture:** The advisor is an AI call (existing `Llm` wrapper) whose output passes through pure-code guardrails. The existing `draftLetter` job becomes `analyzeDispute`: advisor → letter (stance from the advice) → one `analyses` row. Approval is an API call (`POST /api/disputes/:id/approve`, debug-token protected) that records a PENDING row in `actions` and queues an `executeAction` job; that job calls PayPal with an idempotency key and records SENT or FAILED. A sandbox-only settle endpoint drives the demo outcome. No React UI in this phase: the Phase 3 review screen calls these endpoints.

**Tech Stack:** Node 22, TypeScript (strict, ESM, NodeNext), Express 5, Postgres/PGlite, zod, vitest + supertest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-13-dispute-copilot-design.md` (§1 steps 3–6, §3, §8 `actions`/`analyses`, §9 advisor + guardrails, §10 endpoints, §11 errors).

## Global Constraints

- Node 22, ESM, TypeScript `strict: true`; imports use `.js` extensions. No new npm dependencies.
- PayPal base URL is sandbox only (`https://api-m.sandbox.paypal.com`), enforced by config.
- The AI never calls PayPal. Nothing is sent to PayPal until the seller approves (an `approve` API call).
- Secrets only from env; never log tokens, secrets, request bodies, emails, prompts, letters or full IDs; logged IDs go through `maskId`.
- Emails are redacted before any text goes into an LLM prompt.
- All I/O injectable (`fetchImpl`, `sleep`, `now`, `Db`, `Llm`); tests never touch the network; DB tests use `makeTestDb()`.
- Every POST to PayPal that changes a dispute sends a `PayPal-Request-Id` (Phase 1 Task 6 ruling: client retries cover POSTs).
- Guardrails from spec §9, enforced in code: offer amount > 0 and < disputed amount; FIGHT with required evidence missing is downgraded and flagged; only actions PayPal currently allows (the dispute's `links[]` rels) may be recommended or executed.
- `local_state` flow: `NEW → ANALYZING → READY_FOR_REVIEW → ACTION_PENDING → ACTION_SENT → RESOLVED`, or `NEEDS_MANUAL` on errors.
- `actions.state` values: `PENDING`, `SENT`, `FAILED` (spec §8).
- Commit after every task.

## Review Focus

1. The seller approves twice quickly (double click / retried curl) → exactly one `actions` row and one PayPal call; the second request gets 409.
2. PayPal rejects an action with a 4xx (deadline passed, action no longer allowed) → no retries, action FAILED with PayPal's error name, dispute `NEEDS_MANUAL` with a readable reason, and the seller can approve again.
3. The AI suggests an offer of 0, a negative amount, the full amount or a non-number → guardrail replaces it and flags it; the seller never sees an invalid offer.
4. The dispute moves on at PayPal between analysis and approval (e.g. `make_offer` link gone) → approve returns 409 explaining the action is no longer allowed, using a fresh `getDispute`, not the stored snapshot.
5. A worker crash after PayPal accepted the action but before we saved SENT → the retried job reuses the same `PayPal-Request-Id` (`dc-action-<id>`), so PayPal does not apply it twice.

---

### Task 1: PayPal dispute action calls, multipart support and a sandbox spike script

**Files:**
- Modify: `server/src/paypal/client.ts` (accept `FormData` bodies)
- Modify: `server/src/paypal/disputes.ts`
- Create: `server/scripts/actions.ts`; Modify: `server/package.json` (script `spike:action`)
- Test: `server/test/paypal/client.test.ts`, `server/test/paypal/disputes.test.ts`

**Interfaces:**
- Consumes: `PayPalClient.request`, `DisputeDetail`.
- Produces (all in `disputes.ts`; `id` is URL-encoded; every POST passes `{ 'PayPal-Request-Id': requestId }`):
  - `type Money = { currency_code: string; value: string }` (export the existing type)
  - `type DisputeAction = 'FIGHT' | 'OFFER' | 'ACCEPT'`
  - `allowedActions(detail: DisputeDetail): { fight: boolean; offer: boolean; accept: boolean; message: boolean; escalate: boolean; adjudicate: boolean }` from `detail.links[].rel` (`provide_evidence`, `make_offer`, `accept_claim`, `send_message`, `escalate`, `adjudicate`); missing `links` → all false.
  - `sendMessage(c, id, message: string, requestId: string): Promise<unknown>` → POST `/send-message`, JSON `{ message }`
  - `makeOffer(c, id, input: { note: string; amount: Money }, requestId): Promise<unknown>` → POST `/make-offer`, JSON `{ note, offer_amount: amount, offer_type: 'REFUND' }`
  - `acceptClaim(c, id, input: { note: string; amount?: Money }, requestId): Promise<unknown>` → POST `/accept-claim`, JSON `{ note, accept_claim_type: 'REFUND' }` or, when `amount` is given, `{ note, accept_claim_type: 'PARTIAL_REFUND', refund_amount: amount }`
  - `provideEvidence(c, id, input: { notes: string; tracking?: { carrier: string; number: string }[] }, requestId): Promise<unknown>` → POST `/provide-evidence` as `multipart/form-data` with one part named `input` (`application/json`): `{ evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', evidence_info: { tracking_info: [{ carrier_name, tracking_number }] }, notes }] }` (omit `evidence_info` when no tracking)
  - `escalate(c, id, note: string, requestId)` → POST `/escalate` `{ note }`
  - `adjudicate(c, id, outcome: 'SELLER_FAVOR' | 'BUYER_FAVOR', requestId)` → POST `/adjudicate` `{ adjudication_outcome: outcome }`
  - `requireEvidence(c, id, action: 'SELLER_EVIDENCE' | 'BUYER_EVIDENCE', requestId)` → POST `/require-evidence` `{ action }`

- [ ] **Step 1: Write failing tests**
  - client: a `FormData` body is passed to `fetch` unchanged and no `Content-Type` header is set by us (fetch sets the multipart boundary); a JSON POST still gets `Content-Type: application/json`.
  - disputes (fake client recording calls): each function hits the exact path and body above and forwards `PayPal-Request-Id`; `acceptClaim` with amount → `PARTIAL_REFUND` + `refund_amount`; `provideEvidence` sends `FormData` whose `input` part parses to the JSON above; `allowedActions` on `test/fixtures/dispute-inr-sandbox.json` → `{ fight: true, offer: true, accept: true, message: true, escalate: true, adjudicate: false }`.
- [ ] **Step 2: Run** `npx vitest run test/paypal` — expect FAIL.
- [ ] **Step 3: Implement.** In `client.request`, when `body instanceof FormData` send it as-is and skip the JSON content type (the existing 415 rule stays for non-FormData POSTs).
- [ ] **Step 4: Spike script** `scripts/actions.ts` (reuse `_bootstrap.ts` and `formatPayPalError`): `npm run spike:action -- <disputeId> <command> [arg]` with commands `show` (prints `allowedActions`, `status`, `dispute_life_cycle_stage`, `allowed_response_options`), `message <text>`, `offer <amount>`, `evidence`, `accept [amount]`, `escalate`, `require-evidence`, `settle <SELLER_FAVOR|BUYER_FAVOR>`. Request id: `spike-<command>-<Date.now()>`. Prints the response status or PayPal issue codes only (no bodies with buyer data).
- [ ] **Step 5: Run** `npx vitest run test/paypal`, `npm run typecheck:scripts -w server` — expect PASS.
- [ ] **Step 6: Commit** — `feat: PayPal dispute actions (offer, accept, evidence, message, settle) and spike script`

> Manual (Sri, sandbox, in parallel with Tasks 2–4): on a throwaway dispute run `show`, then `offer 10.00` on one dispute, `evidence` on another, `escalate` → `show` → `settle SELLER_FAVOR` on a third. Record which calls succeed and the stage/status changes in spec §10 "Phase 2 findings". If a body shape is rejected, the controller fixes `disputes.ts` before Task 6.

---

### Task 2: Readable facts, store name and stance-matched letters

**Files:**
- Modify: `server/src/agent/evidence.ts`, `server/src/agent/letter.ts`, `server/src/config.ts`, `.env.example`
- Test: `server/test/agent/evidence.test.ts`, `server/test/agent/letter.test.ts`, `server/test/config.test.ts`

**Interfaces:**
- Produces:
  - `config.storeName: string` from `STORE_NAME`, default `Dispute Copilot Demo Store`.
  - `formatFactDate(iso: string): string` in `evidence.ts` → UTC `"Oct 16, 2026"` (`en-US`, `month: 'short'`, `day: 'numeric'`, `year: 'numeric'`, `timeZone: 'UTC'`); unparseable input returned unchanged. Used for `order.created_at`, `shipment.N.shipped_at`, `shipment.N.delivered_at`.
  - `draftLetter(llm, pack, stance, allowedSources, opts: { storeName: string; offerAmount?: string })` — the fifth parameter is new and required.
    - FIGHT: addressed to PayPal's dispute team (as today).
    - OFFER: addressed to the buyer, proposes a refund of exactly `offerAmount` `pack.currency`; `offerAmount` is mandatory for OFFER (throw `LetterRejectedError('offer amount missing')` before calling the LLM).
    - ACCEPT: addressed to the buyer, says a full refund is being issued.
    - All: sign off with `storeName` (never "Seller"); the prompt states the store name and, for OFFER, the amount.
    - Validation adds: an OFFER letter must contain `offerAmount` verbatim, else `LetterRejectedError('offer amount not stated')`.

- [ ] **Step 1: Write failing tests** — evidence: DEMO-HIST-02 pack's `order.created_at` value matches `/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/`; `formatFactDate('not a date') === 'not a date'`. letter: the prompt sent to a fake LLM contains the store name and, for OFFER, `"12.50"`; OFFER without amount rejects; OFFER letter missing the amount rejects; FIGHT system prompt mentions PayPal's dispute team and OFFER/ACCEPT system prompt mentions the buyer. config: default and override of `STORE_NAME`.
- [ ] **Step 2: Run** focused tests — expect FAIL.
- [ ] **Step 3: Implement**; update the existing `draftLetter` call site in `server/src/jobs/draftLetter.ts` to pass `{ storeName: 'Dispute Copilot Demo Store' }` for now (Task 4 wires config).
- [ ] **Step 4: Run** full suite — expect PASS (update any Phase 1 assertions that expected ISO dates in facts).
- [ ] **Step 5: Commit** — `feat: readable fact dates, store sign-off and stance-matched letters`

---

### Task 3: Advisor with code guardrails

**Files:**
- Create: `server/src/agent/advisor.ts`
- Test: `server/test/agent/advisor.test.ts`

**Interfaces:**
- Consumes: `Llm`, `EvidencePack`, `DisputeDetail`, `allowedActions` (Task 1).
- Produces:
  - `type Advice = { recommendation: DisputeAction; confidence: number; evidenceStrength: 'STRONG' | 'MEDIUM' | 'WEAK'; reasons: string[]; missingEvidence: string[]; suggestedOffer: string | null; flags: string[] }` (`suggestedOffer` is a 2-decimal string or null).
  - `class AdviceUnavailableError extends Error` — no allowed action exists (all of fight/offer/accept false).
  - `applyGuardrails(raw: RawAdvice, ctx: { pack: EvidencePack; allowed: ReturnType<typeof allowedActions> }): Advice` — pure; `RawAdvice` is the zod output of the AI (spec §9 JSON keys: `recommendation`, `confidence` 0–100, `evidence_strength`, `reasons`, `missing_evidence`, `suggested_offer_amount` number|null).
  - `advise(llm: Llm, pack: EvidencePack, detail: DisputeDetail): Promise<{ advice: Advice; model: string }>`.
- Guardrail rules, applied in this order (each change appends a flag string):
  1. `missingEvidence` = union of AI list and `pack.missing` (pack first, de-duplicated).
  2. FIGHT with `pack.missing.length > 0` → OFFER, flag `"Downgraded from FIGHT: missing <items joined with ', '>"`, `evidenceStrength` capped at `MEDIUM`.
  3. Offer amount (only when recommendation is OFFER): valid iff finite, > 0 and < `pack.amount`; otherwise use 50% of `pack.amount` rounded to cents, flag `"Offer amount adjusted"`. Non-OFFER → `suggestedOffer` null.
  4. Recommendation not allowed by `allowed` → first allowed in the order OFFER, ACCEPT, FIGHT (never FIGHT if rule 2 applied), flag `"<X> not allowed by PayPal now; switched to <Y>"`; none allowed → `AdviceUnavailableError`.
- Prompt: system text lists the JSON shape and says the AI must use only listed facts; user text = reason, amount, currency, checklist with present/missing, fact lines formatted exactly as in `letter.ts` (fenced `<<< >>>`, emails redacted — move those two helpers into `agent/promptText.ts` and import them in both files).

- [ ] **Step 1: Write failing tests** (guardrails pure, advise with fake LLM):
  - FIGHT + nothing missing + fight allowed → unchanged, `flags` `[]`.
  - FIGHT + pack missing `delivery confirmation` → OFFER, flag starts `Downgraded from FIGHT`, strength `MEDIUM` when AI said STRONG.
  - OFFER with `suggested_offer_amount` 0 / -5 / 49 (= amount) / null on a 49.00 pack → `"24.50"` + `Offer amount adjusted`; 12.5 → `"12.50"`, no flag.
  - OFFER when `offer: false, accept: true` → ACCEPT with switch flag; all false → `AdviceUnavailableError`.
  - `advise` passes the AI JSON through `applyGuardrails` and returns the LLM's `model`; the prompt contains `[email]` instead of an email in a fact.
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement.** **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** — `feat: advisor recommends fight, offer or accept with code guardrails`

---

### Task 4: analyzeDispute job and richer dispute API

**Files:**
- Create: `server/src/db/migrations/002_phase2.sql`
- Rename: `server/src/jobs/draftLetter.ts` → `server/src/jobs/analyzeDispute.ts` (and its test)
- Modify: `server/src/jobs/handlers.ts`, `server/src/jobs/processDispute.ts`, `server/src/routes/disputes.ts`, `server/src/index.ts`
- Test: `server/test/jobs/analyzeDispute.test.ts`, `server/test/routes/disputes.test.ts`, `server/test/e2e/dispute-flow.test.ts`

**Interfaces:**
- Migration 002: `alter table analyses add column flags jsonb not null default '[]'`; `alter table actions add column created_at timestamptz not null default now()`; `create unique index actions_one_open_per_dispute on actions (dispute_id) where state = 'PENDING'`.
- `analyzeDisputeJob(deps: { db: Db; llm: Llm; storeName: string }): JobHandler` — same guards as today's `draftLetterJob` (only while `ANALYZING`, final-attempt NEEDS_MANUAL with reason codes), then `advise` → `draftLetter(llm, pack, advice.recommendation, [disputeId, orderId], { storeName, offerAmount: advice.suggestedOffer ?? undefined })` → in one transaction insert `analyses (dispute_id, recommendation, confidence, evidence_strength, reasons, missing_evidence, suggested_offer, flags, letter_draft, model_used)` and set `READY_FOR_REVIEW`. `model_used` = advisor model and letter model joined with `+` when they differ. `AdviceUnavailableError` → `NEEDS_MANUAL` `"No PayPal action is open for this dispute"` immediately (no retry).
- `buildHandlers` registers `analyzeDispute` and keeps `draftLetter` as an alias of the same handler (jobs queued before deploy). `processDispute` enqueues `analyzeDispute` (dedupe check matches both type names). `HandlerDeps` gains `storeName`.
- `GET /api/disputes/:id` adds: `allowedActions` (from stored `raw`), `outcome` (`raw.dispute_outcome?.outcome_code ?? null`), `actions` (all rows newest first: `{ id, type, state, error, createdAt, sentAt }`), and `latestAnalysis` gains `confidence`, `evidenceStrength`, `reasons`, `missingEvidence`, `suggestedOffer` (string|null), `flags`.

- [ ] **Step 1: Write failing tests**
  - job: fake LLM returning advisor JSON then letter JSON → analyses row with recommendation, flags and letter; state READY_FOR_REVIEW. Pack with missing evidence + AI says FIGHT → stored recommendation OFFER and the OFFER letter contains the suggested amount. No allowed action → NEEDS_MANUAL with the exact reason on attempt 1.
  - handlers: a queued `draftLetter` job is handled by the same handler.
  - route: detail includes the new fields; `outcome` from a RESOLVED fixture (`dispute_outcome.outcome_code = 'RESOLVED_SELLER_FAVOUR'`).
  - e2e: existing flow still reaches READY_FOR_REVIEW, now with a recommendation.
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement** (index passes `config.storeName`). **Step 4: Run** full suite — PASS.
- [ ] **Step 5: Commit** — `feat: analyze disputes with advisor and stance-matched letter`

---

### Task 5: Approve endpoint and actions repo

**Files:**
- Create: `server/src/actions/repo.ts`, `server/src/routes/actions.ts`
- Modify: `server/src/app.ts` (mount route; `AppDeps` already has `paypal`)
- Test: `server/test/actions/repo.test.ts`, `server/test/routes/actions.test.ts`

**Interfaces:**
- `type ActionRow = { id: number; disputeId: string; type: DisputeAction; payload: ActionPayload; state: 'PENDING' | 'SENT' | 'FAILED'; error: string | null; createdAt: string; sentAt: string | null }`
- `type ActionPayload = { note: string; offerAmount?: string; currency: string; tracking?: { carrier: string; number: string }[] }`
- `createPendingAction(tx: Db, disputeId: string, type: DisputeAction, payload: ActionPayload, now: Date): Promise<number>` — throws `ActionConflictError` on the unique-index violation.
- `markSent(db, id, response: unknown, now)`, `markFailed(db, id, error: string)`, `getAction(db, id): Promise<ActionRow | null>`, `listActions(db, disputeId): Promise<ActionRow[]>`.
- `POST /api/disputes/:id/approve` (debug token), body `{ action: 'FIGHT'|'OFFER'|'ACCEPT', note: string, offerAmount?: string }`:
  - 404 unknown dispute; 409 `{ error: 'not ready' }` unless `local_state` is `READY_FOR_REVIEW` or `NEEDS_MANUAL`.
  - 400 when `note` is not 20–2000 chars; OFFER needs `offerAmount` matching `^\d+(\.\d{1,2})?$`, > 0 and < dispute amount.
  - Fresh `getDispute` (Review Focus 4) → 409 `{ error: 'action not allowed now', allowed }` when the action's link is gone; refresh stored `raw` via `upsertDispute`.
  - FIGHT payload `tracking` = every shipment with a tracking number from the order bundle.
  - In one transaction: `createPendingAction`, `setLocalState(ACTION_PENDING)`, `enqueue('executeAction', { actionId })`. Conflict → 409 `{ error: 'action already pending' }`.
  - 202 `{ actionId, state: 'PENDING' }`. Logs only masked ids.

- [ ] **Step 1: Write failing tests** — 401 without token; 404; 409 not ready; 400 short note / bad amount / amount ≥ dispute amount; 409 when fresh dispute lacks `make_offer`; success → 202, one PENDING row, state ACTION_PENDING, one `executeAction` job; two concurrent approves (`Promise.all`) → one 202 and one 409, one row (Review Focus 1).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat: seller approval endpoint records and queues the PayPal action`

---

### Task 6: executeAction job

**Files:**
- Create: `server/src/jobs/executeAction.ts`
- Modify: `server/src/jobs/handlers.ts`
- Test: `server/test/jobs/executeAction.test.ts`, extend `server/test/e2e/dispute-flow.test.ts`

**Interfaces:**
- `executeActionJob(deps: { db: Db; paypal: PayPalClient; now: () => Date }): JobHandler`, payload `{ actionId: number }`.
- Skip (complete) unless the action is `PENDING`.
- Request id `dc-action-<id>` on every attempt (Review Focus 5).
- FIGHT → `provideEvidence(notes = payload.note, tracking)`; OFFER → `makeOffer(note, { currency_code, value: offerAmount })`; ACCEPT → `acceptClaim(note)`.
- Success → `markSent`, `setLocalState(ACTION_SENT)`, `enqueue('processDispute', { disputeId })` in one transaction.
- `PayPalError` with status 400–499 except 429 → `markFailed(error = "<name>: <message>")`, dispute `NEEDS_MANUAL` reason `"PayPal rejected the action (<name>)"`, job completes without rethrow (Review Focus 2).
- Other errors: rethrow; on the final attempt (`job.attempts >= MAX_ATTEMPTS`) first `markFailed` + `NEEDS_MANUAL` `"Could not reach PayPal"`.

- [ ] **Step 1: Write failing tests** — each action type calls the right function with `dc-action-<id>`; success path states + processDispute job queued; 422 `UNPROCESSABLE_ENTITY` → FAILED, NEEDS_MANUAL, not rethrown; 503 attempt 1 → rethrow, still PENDING; 503 attempt 3 → FAILED + NEEDS_MANUAL + rethrow; non-PENDING action → no PayPal call. e2e: webhook → analyze → approve OFFER → executeAction → ACTION_SENT with fake PayPal recording the make-offer body.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** full suite — PASS.
- [ ] **Step 5: Commit** — `feat: execute approved actions against PayPal with idempotency keys`

---

### Task 7: Sandbox settle endpoint, docs and runbook

**Files:**
- Modify: `server/src/routes/actions.ts`
- Modify: `docs/runbooks/sandbox-dispute.md`, `README.md`, spec §9 and §10 (Phase 2 decisions and findings)
- Test: `server/test/routes/actions.test.ts`

**Interfaces:**
- `POST /api/disputes/:id/sandbox/settle` (debug token), body `{ outcome: 'SELLER_FAVOR' | 'BUYER_FAVOR' }`: fresh `getDispute`; if `allowedActions(...).adjudicate` → `adjudicate(..., 'dc-settle-<disputeId>-<outcome>')`, enqueue `processDispute`, 202; else 409 `{ error: 'not settleable yet', status, stage, hint }` where `hint` = `"PayPal only allows settling disputes under review; escalate or wait for the claim stage"`. (Sandbox-only is already guaranteed by the config's sandbox base-URL check.)

- [ ] **Step 1: Write failing tests** — 409 with hint when no `adjudicate` link; 202 + adjudicate called + processDispute queued when present; 400 bad outcome.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** full suite, `npm run build`, `npm run typecheck:scripts -w server` — PASS.
- [ ] **Step 5: Docs** — runbook: approve commands for each action (PowerShell `curl.exe` with `-X POST`, JSON body via a file to avoid quoting problems), settle command, what each state means; README: new endpoints and `STORE_NAME`; spec §9: Phase 2 decisions (guardrail order, alias job, API-only approval in Phase 2) and §10 findings from the Task 1 spike.
- [ ] **Step 6: Commit** — `feat: sandbox settle endpoint; docs: Phase 2 runbook and decisions`

**Milestone check (Asana "Approve button triggers the right PayPal action end to end"):** on Render, a new `/store` dispute reaches READY_FOR_REVIEW with a recommendation; `approve` sends it; `GET` shows the action SENT and ACTION_SENT; after settle (or PayPal's own resolution) the dispute shows RESOLVED with an `outcome`.
