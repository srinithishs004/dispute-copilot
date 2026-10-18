# Dispute Copilot — Design Spec

Status: Draft for review · Date: 2026-10-13 · Author: Sri (solo)
Hackathon: PayPal AI Hackathon (Devpost). Submit target: Nov 11, 2026 (hard cutoff Nov 12, 12:00 pm PT = Nov 13, 1:30 am IST).

## 1. Summary

Dispute Copilot helps a small online seller handle PayPal disputes. When a buyer opens a dispute, the app:

1. receives the PayPal webhook,
2. gathers the matching order, shipping and message history,
3. uses AI to judge how strong the seller's case is and recommends **Fight**, **Offer partial refund**, or **Accept**,
4. drafts the response letter and evidence pack,
5. waits for the seller to review and approve,
6. sends the chosen action to PayPal through the Disputes API,
7. warns the seller before any response deadline.

The AI never acts on PayPal without the seller clicking Approve.

## 2. User and problem

**User:** a small online seller (1–3 people, no support team) who takes payments with PayPal.

**Problem:** small sellers lose disputes they could have won, and waste time fighting ones they can't win, because they:
- miss the response deadline,
- send weak evidence (a screenshot instead of tracking + delivery proof + buyer messages),
- have no way to judge whether a case is worth fighting.

**Before:** seller finds the dispute late, digs through emails and courier sites, writes a reply from scratch.
**After:** seller gets an alert with a ready evidence pack, a clear recommendation with reasons, and one Approve button.

## 3. Success criteria

The demo must show, live in the PayPal sandbox:
- a buyer pays for an item in our demo store with PayPal (real sandbox transaction),
- the buyer opens a dispute,
- the webhook arrives and the dispute appears on the dashboard within ~1 minute,
- the AI recommendation, reasons, evidence pack and draft letter appear,
- the seller approves and the app calls the correct PayPal endpoint successfully,
- the sandbox settle endpoint resolves the dispute and the dashboard shows the outcome.

Plus, for the pitch: run the advisor over 10–15 sample cases and show results vs. a "no tool" baseline (deadlines met, evidence completeness).

## 4. Scope

**In:**
- Demo storefront with PayPal Checkout (sandbox) so disputes link to real transactions
- Webhook intake (signature verified, idempotent)
- Evidence agent, advisor, letter drafter
- Seller actions: provide evidence, make offer, accept claim, send message
- Dashboard (AG Grid) and dispute review screen
- Deadline watcher (cron) with in-app warnings
- Deploy on Render

**Out (unless ahead of schedule at Nov 1 check):**
- Prevention agent (pre-dispute signals)
- Elastic similar-case search
- Real Shopify/WooCommerce integration, multi-seller accounts, email/SMS alerts, login system beyond a single demo seller

## 5. Tech stack

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language for a solo dev |
| Frontend | React + Vite, AG Grid (Community) | Sponsor tool, fast dev server |
| Backend | Node 22 + Express | Simple, many examples |
| Database | Postgres (`DATABASE_URL`); PGlite at `.data/pglite` (`PGLITE_DIR`) when `DATABASE_URL` is unset | Docker/psql not installed locally; PGlite needs no install |
| Background jobs | Own `jobs` table in Postgres/PGlite, claimed with `FOR UPDATE SKIP LOCKED` (5 minute lease, 3 attempts, 30 s retry delay) | No Redis; works on PGlite, which pg-boss does not (decision 1, see below) |
| AI | Gemini Flash (free tier) primary, Groq (free tier) fallback | Free; one wrapper so providers can swap |
| Tests | Vitest + supertest; PayPal/AI calls mocked | Fast, no network in unit tests |
| Hosting | Render: web service, background worker, cron job, Postgres | Sponsor tool |

## 6. Architecture

```
Buyer (sandbox) ──pays──> Demo store page ──PayPal Orders API──> PayPal sandbox
Buyer opens dispute in sandbox ──> PayPal sends webhook
                                        │
                                        ▼
                         [web] POST /webhooks/paypal
                         verify signature → save event → enqueue job
                                        │
                                        ▼
                         [worker] processDispute job
                           1. fetch full dispute from PayPal
                           2. match to our order (invoice_id)
                           3. build evidence pack (code, not AI)
                           4. advisor (AI) → recommendation
                           5. letter drafter (AI) → draft
                           6. save analysis, status = READY_FOR_REVIEW
                                        │
                                        ▼
                         [web] React dashboard + review screen
                         seller edits / approves
                                        │
                                        ▼
                         [worker] executeAction job → PayPal Disputes API
                                        │
                         [cron] every hour: deadline sweep → flag disputes due soon
```

**Phase 1 decisions (approved deviations from the original plan)**

1. **Own `jobs` table instead of pg-boss.** Jobs are claimed with `FOR UPDATE SKIP LOCKED`. A claimed job has a 5 minute lease; if the worker dies, the job becomes claimable again. Each job gets 3 attempts with a 30 second retry delay.
2. **PGlite when there is no `DATABASE_URL`.** Data is stored at `.data/pglite` (env `PGLITE_DIR`). In that mode the worker runs inside the web process (`RUN_WORKER_INLINE`, default true only when `DATABASE_URL` is unset). With Postgres, a separate worker process can run the jobs. Render's free web service has no persistent disk and loses local files when it sleeps (~15 min idle), so store orders would vanish. Decision (2026-10-16, Sri): Render uses a Basic-256mb Render Postgres paid from credits (`render.yaml` `databases`), with `RUN_WORKER_INLINE=true` on the web service.
3. **Fight-only letter in Phase 1.** The letter is drafted for the FIGHT stance only. The Phase 2 advisor will pick fight, offer or accept, and the drafter will follow its choice.

Three Render services share one codebase: `web` (API + built React app), `worker` (jobs), `cron` (deadline sweep).

## 7. Repo layout

```
/server
  src/paypal/client.ts       OAuth token cache + request wrapper with retries
  src/paypal/disputes.ts     list, get, provideEvidence, makeOffer, acceptClaim, sendMessage, sandboxSettle
  src/paypal/orders.ts       create/capture order for the demo store
  src/paypal/webhooks.ts     verify webhook signature
  src/ai/llm.ts              generateJson(prompt, schema): Gemini first, Groq on failure
  src/agent/evidence.ts      dispute → evidence pack (pure code)
  src/agent/advisor.ts       evidence pack → recommendation (AI + guardrails)
  src/agent/letter.ts        evidence pack + recommendation → letter draft (AI)
  src/jobs/                  processDispute, executeAction, deadlineSweep
  src/routes/                webhooks, disputes, store, actions
  src/db/                    schema migrations, queries, seed data
/web
  src/pages/Dashboard.tsx    AG Grid list of disputes
  src/pages/DisputeReview.tsx
  src/pages/Store.tsx        demo storefront (buyer side)
/docs
render.yaml
```

Each module has one job and is testable alone. Agent modules never call PayPal directly.

## 8. Data model

| Table | Key fields |
|---|---|
| `orders` | id (= PayPal invoice_id), item, amount, currency, buyer_email, paypal_order_id, paypal_capture_id, created_at |
| `shipments` | order_id, carrier, tracking_number, status, shipped_at, delivered_at, signature_proof (bool) |
| `messages` | order_id, from (buyer/seller), body, sent_at |
| `store_policy` | refund_window_days, policy_text |
| `webhook_events` | paypal_event_id (unique), event_type, raw_json, verified, received_at, processed_at |
| `disputes` | paypal_dispute_id (unique), order_id, reason, status, stage, amount, response_due_at, raw_json, local_state |
| `analyses` | dispute_id, recommendation, confidence, evidence_strength, reasons[], missing_evidence[], suggested_offer, letter_draft, model_used, created_at |
| `evidence_items` | dispute_id, type, description, file_path |
| `actions` | dispute_id, type, payload_json, state (PENDING/SENT/FAILED), paypal_response_json, error, approved_at, sent_at |

`local_state` flow: `NEW → ANALYZING → READY_FOR_REVIEW → ACTION_PENDING → ACTION_SENT → RESOLVED` (or `NEEDS_MANUAL` on errors).

Mock data for Phase 1: 10–15 orders seeded with a mix of strong cases (tracking + delivery + signature) and weak ones (no tracking, angry messages, outside policy).

## 9. AI agent design

**Evidence builder (no AI):** looks up the order by the dispute's invoice ID and collects order, shipment, messages and policy into a structured evidence pack, plus a checklist of what's present or missing for the dispute reason (e.g. "Item not received" needs tracking + delivery confirmation).

**Advisor (AI):** input is the evidence pack + dispute reason + amount. Output (strict JSON, validated with zod):

```json
{
  "recommendation": "FIGHT | OFFER | ACCEPT",
  "confidence": 0-100,
  "evidence_strength": "STRONG | MEDIUM | WEAK",
  "reasons": ["..."],
  "missing_evidence": ["..."],
  "suggested_offer_amount": 12.50
}
```

Guardrails in code (AI can't override):
- offer amount must be > 0 and < disputed amount,
- if required evidence for the reason is missing, FIGHT is downgraded and flagged,
- invalid JSON → retry once → try Groq → else `NEEDS_MANUAL`. In Phase 1, if no provider can draft the letter after the job's 3 attempts, the dispute goes to `NEEDS_MANUAL` with the reason "AI draft unavailable".

**Letter drafter (AI):** in Phase 1 it always writes for the FIGHT stance (decision 3 in section 6); the advisor arrives in Phase 2. It writes a short, factual response that only cites facts present in the evidence pack. The seller can edit it before approving.

**Human in the loop:** nothing is sent to PayPal until the seller clicks Approve.

### Phase 2 decisions

- **Guardrail order** (code, the AI cannot override): (1) missing required evidence is checked against the union of what PayPal requests and what the reason needs; (2) FIGHT with missing evidence is downgraded, and the evidence strength is capped; (4) the allowed-action switch (only actions PayPal currently offers via `links[]`) runs before (3) the offer-amount check, so an offer amount is only validated for an action that is still possible. If FIGHT is the only allowed action it is kept, with a flag, instead of being downgraded to something PayPal would refuse.
- **`analyzeDispute`** replaces the Phase 1 letter job. It produces the recommendation and the letter together. The old `draftLetter` job name stays as a legacy alias so queued jobs still run.
- **Approval is API-only** (`POST /api/disputes/:id/approve`) until the Phase 3 review screen. Nothing is sent to PayPal before it.
- **Idempotency key** for the PayPal call is `dc-action-<actionId>`, so a retry never sends the action twice. Settle uses `dc-settle-<disputeId>-<outcome>`.
- **State transitions are conditional (compare-and-set):** e.g. `READY_FOR_REVIEW` to `ACTION_PENDING` only succeeds if the dispute is still in the expected state, inside the same transaction as the action row and job. Concurrent approves therefore produce one winner and one 409.
- **Sandbox settle** (`POST /api/disputes/:id/sandbox/settle`) calls PayPal's adjudicate only when the fresh dispute has an `adjudicate` link.

## 10. PayPal integration

- REST API with OAuth client credentials (sandbox), token cached until expiry.
- Webhooks: dispute created / updated / resolved events; verify each with PayPal's verify-webhook-signature endpoint; ignore duplicates by `paypal_event_id`.
- Disputes API endpoints used: list, show details, provide-evidence, make-offer, accept-claim, send-message; sandbox-only adjudicate (settle) and require-evidence for the demo.
- Orders API for the demo store, with our order ID set as `invoice_id` so disputes map back to orders.
- Exact enum values (status, reason, evidence types) and the evidence upload format get confirmed during the Phase 0 spike and recorded here.

### Phase 0 findings (sandbox run, Oct 13–15, 2026)

**Payment flow**
- Orders need `payment_source.paypal.experience_context` with `return_url`, `user_action: PAY_NOW` — without a return URL the approval never completes and capture fails with `ORDER_NOT_APPROVED`.
- PayPal returns `415 UNSUPPORTED_MEDIA_TYPE` on a body-less POST (capture) unless `Content-Type: application/json` is sent.
- `.env` must use the API host `https://api-m.sandbox.paypal.com`, not the website `https://sandbox.paypal.com` (the config guard catches this).

**How the dispute was opened (buyer, sandbox.paypal.com)**
Activity → payment → Report a problem → "I haven't received the item or service" → item details (physical product, qty 1) → "The item hasn't reached me or I refused delivery" → expected delivery date + refund amount → seller contacted: no → note → Submit. Result: case id `PP-R-…`, opened in the **INQUIRY** stage, with a resolve-with-seller window of ~20 days. Buyer uploads accept JPG/PNG/GIF/PDF/TXT, 10 MB each, 50 MB total.

**Dispute detail fields seen (GET /v1/customer/disputes/{id})**
- `dispute_id` (`PP-R-…` for an inquiry), `reason` = `MERCHANDISE_OR_SERVICE_NOT_RECEIVED`, `status` = `WAITING_FOR_SELLER_RESPONSE`, `dispute_state` = `REQUIRED_ACTION`, `dispute_life_cycle_stage` = `INQUIRY`, `dispute_channel` = `INTERNAL`
- `dispute_amount {currency_code, value}`, `seller_response_due_date` (ISO time)
- `disputed_transactions[]`: `invoice_number` (= our order id — **primary match key**), `seller_transaction_id` (= our capture id — fallback match key), `buyer_transaction_id` (different id shown to the buyer), `items[]` (`item_name`, `item_type`, `reason`), `seller_protection_eligible`, `seller_protection_type`
- `messages[]` (`posted_by` BUYER/SELLER, `time_posted`, `content`) — the buyer's own words; usable as evidence facts
- `evidences[]` — includes what PayPal asks of the seller, e.g. `{evidence_type: PROOF_OF_FULFILLMENT, source: REQUESTED_FROM_SELLER}`
- `allowed_response_options` — e.g. `accept_claim.accept_claim_types [PARTIAL_REFUND, REFUND]`, `make_offer.offer_types [REFUND]`; the advisor must only recommend actions listed here
- `links[]` with `rel` = `send_message`, `provide_evidence`, `accept_claim`, `make_offer`, `escalate` — also signals which actions are open now
- `fund_movements[]` — PayPal placed a hold on the seller (`HOLD_PLACED`, net of fees)
- `offer.buyer_requested_amount`, `refund_details.allowed_refund_amount`

**Webhooks (confirmed Oct 16 on Render, webhook subscribed to CREATED/UPDATED/RESOLVED)**
- Both `CUSTOMER.DISPUTE.CREATED` and `CUSTOMER.DISPUTE.UPDATED` arrived and passed `verify-webhook-signature` using the parsed body.
- The dispute id is at **`resource.dispute_id`** — there is no `resource.id` (Phase 0 logged `resourceId: null`). Phase 1's `disputeIdFromEvent` reads `resource.dispute_id` first.
- `resource` is a near-complete dispute snapshot (reason, status, amount, `disputed_transactions` with `invoice_number` and `seller_transaction_id`, messages). CREATED arrives before PayPal finishes setup (`status: UNDER_REVIEW`, no due date yet); UPDATED ~20 s later adds `seller_response_due_date`, `allowed_response_options` and the action links. So we always re-fetch the dispute via the API rather than trusting the webhook body.
- Delay: dispute opened 00:26:23 → CREATED received 00:29:41 (~3 min); UPDATED followed ~20 s later.
- Webhook payload links use the host `api.sandbox.paypal.com` (not `api-m.`); our client ignores them and builds URLs from `PAYPAL_BASE_URL`.
- Free Render service slept between tests; keep `/health` warm before demos, and events must be stored durably (Phase 1 database).

### Phase 2 findings (sandbox, Oct 18)

- `show` on an **INQUIRY** dispute lists the links `send_message`, `provide_evidence`, `accept_claim`, `make_offer`, `escalate`. There is no `adjudicate` link.
- `make-offer` with `{note, offer_amount, offer_type: REFUND}` succeeded. Status went to `UNDER_REVIEW` and then `WAITING_FOR_BUYER_RESPONSE`; the stage stays `INQUIRY`.
- After an offer the `make_offer` link disappears and `accept_claim_types` becomes `[REFUND]` only.
- `adjudicate` is only offered for disputes under review in the claim stage (per PayPal docs). So settle on a fresh inquiry returns 409 until the case is escalated or reaches the claim stage.
- Results for escalate, provide-evidence and settle: not yet recorded.

## 11. Error handling

- PayPal 429/5xx: retry with exponential backoff (3 tries), then mark action FAILED with the message shown in the UI and a Retry button.
- PayPal 4xx: no retry; show the error clearly (e.g. "deadline passed", "evidence type not allowed").
- AI failure: fall back to Groq; if both fail, show the evidence pack without a recommendation (`NEEDS_MANUAL`).
- Webhook: always reply 200 quickly after saving; processing happens in the worker.
- Worker crash: the job's lease (5 minutes) expires and another run claims it, up to 3 attempts in total; jobs are safe to run twice.

## 12. Security

- All keys in environment variables; `.env` is git-ignored; never logged.
- Logs mask emails and IDs. Every logged ID goes through `maskId` (`server/src/log.ts`).
- Never log tokens, secrets, request bodies, emails, prompts, letters or full IDs.
- Emails are redacted before any text goes into an LLM prompt.
- Protected endpoints (`/debug/events`, `/api/disputes*`) need the `x-debug-token` header and return 404 when `DEBUG_TOKEN` is not set.
- Sandbox only. No real customer data anywhere — repo, video, Discord.

## 13. Testing

- Unit: evidence builder (fixture disputes per reason), advisor guardrails, LLM wrapper fallback, webhook verification + duplicate handling, PayPal client retries (HTTP mocked).
- Integration: route tests with supertest against a test database.
- Manual end-to-end in sandbox: the demo script in section 3, run before every deploy from Phase 3 on.

## 14. Deployment

`render.yaml` blueprint: web service, background worker, cron job (hourly deadline sweep), Postgres. (Phase 1 runs on the single web service with the inline worker and PGlite; the rest arrives later.) Env vars via a Render env group.

## 15. Risks and open questions

| Risk | Plan |
|---|---|
| Exact way to open a dispute in sandbox | Phase 0 spike; fallback is the sandbox require-evidence/adjudicate endpoints on a real sandbox transaction |
| Sandbox webhooks can be slow | Add a "Sync from PayPal" button that calls the list endpoint |
| Gemini free-tier rate limits | Small prompts, cache analyses, Groq fallback |
| Render free tier: services sleep and free Postgres may expire before judging ends (Dec 15) | Check current Render free limits in Phase 3; budget for the cheapest paid plan or Render credits if needed |
| Scope creep | Anything not in section 4 waits for the Nov 1 go/no-go |
