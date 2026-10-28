# Phase 3: Seller App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser product for sellers and judges: public home and judge guide, login (owner and judge), an AG Studio dashboard with custom widgets and the Dispute Analyst agent, a Review page that approves PayPal actions, plus the server pieces they need.

**Architecture:** New `web/` npm workspace (React 18 + Vite + TypeScript + `ag-studio-react@3.0.0`), built to static files and served by the existing Express app with an SPA fallback. Server gains cookie sessions with two roles, a read-only dashboard data feed, a model proxy for the Studio Agent Framework (OpenAI-compatible chat completions with tools: Gemini first, Groq fallback), an hourly deadline sweep, and fixes from the live tests.

**Tech Stack:** Node 22, Express 5, Postgres/PGlite, zod, vitest + supertest (server); React 18, Vite, TypeScript, react-router, `ag-studio-react` 3.0.0, Kaala CSS, vitest + React Testing Library + jsdom (web); Playwright Chromium (preinstalled, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) for the spike and smoke checks.

**Spec:** `docs/superpowers/specs/2026-10-27-phase3-seller-app-design.md` (main spec: `docs/superpowers/specs/2026-10-13-dispute-copilot-design.md`).

## Global Constraints

- Node 22, ESM, TypeScript strict; server imports use `.js` extensions. New runtime dependencies only in `web/` (react, react-dom, react-router-dom, ag-studio-react@3.0.0) plus dev tooling (vite, @vitejs/plugin-react, vitest, @testing-library/react, jsdom). No new server runtime dependencies (use Node `crypto` for scrypt, HMAC and timing-safe compare).
- Secrets only from env; never log tokens, secrets, passwords, cookies, prompts, letters, notes or full IDs; IDs via `maskId`.
- The AI never calls PayPal and never approves. The Dispute Analyst is read-only.
- AI keys never reach the browser. The AG Studio licence key is a public client key (`VITE_AG_STUDIO_LICENSE_KEY`), allowed in the bundle.
- Roles: `owner` and `judge`. Judge cannot use `POST /api/disputes/sync`, `POST /api/disputes/:id/sandbox/settle`, `/debug/events`. Every other seller route accepts either role.
- Seller routes accept the session cookie (any role) or the existing `x-debug-token` header (treated as owner).
- Kaala design system: tokens only (no raw hex in components); themes `night` and `day` via `data-theme` on `<html>`; follow `prefers-color-scheme`, manual switch persisted in `localStorage` key `kaala-theme`, default night; one primary button per screen; violet under 5%; no gradients, emoji, pill buttons, cursor effects, em dashes or en dashes in UI copy; no made-up numbers.
- Accessibility: visible focus ring, contrast 4.5:1 text, works at 390px width with no horizontal scroll, respects `prefers-reduced-motion`.
- Tests: server `npm test -w server`; web `npm test -w web`; root `npm run build` must build both.
- Commit after every task. Never change git config.

## Review Focus

1. A judge refreshes the Review page after their session expires → redirected to `/login?next=/disputes/<id>`, and after login lands back on the same dispute (Task 6 test).
2. Approve is clicked twice or while a request is in flight → button disabled while pending; the server's 409 is shown as "An action is already pending" rather than a crash (Task 7 test).
3. Both AI providers fail or rate limit the Dispute Analyst → the panel shows "Analyst unavailable, try again shortly" and the dashboard keeps working (Task 4 test for 503 body, Task 9 test for the message).
4. A cross-site page posts to `/api/disputes/:id/approve` with the judge's cookie → rejected by the Origin check (Task 2 test).
5. A dispute with no analysis, no order, or `NEEDS_MANUAL` opens in Review → page renders the explanation banner and lets the seller write the letter themselves (Task 7 test).

---

### Task 1: Spike — AG Studio agent adapter contract (throwaway)

**Files:** scratch only under the controller's scratchpad; nothing committed to `web/` or `server/`.

**Question:** With `ag-studio-react@3.0.0`, can a custom primary agent (`directLlmRunner` with our own `AgLlmAdapter`) delegate to Studio's built-in `data` and `widget` agents (wrapped with the same adapter) and add a chart to a page, when the adapter returns non-streamed responses mapped from OpenAI-style chat completions?

- [ ] **Step 1:** Minimal Vite React page: `AgStudio` with a `sources` dataset of 10 fake dispute rows, `ai` = `createAiHarness(api, ({ tools, builtIn }) => ({ agents: [analyst, ...wrapped built-ins], primary: 'dispute-analyst' }))`, where `wrapped = directLlmRunner({ ...builtIn.<id>, adapter })`.
- [ ] **Step 2:** A scripted fake adapter (no network) that, turn by turn, returns: a `delegate_to` tool call to `widget`, then the widget agent's tool calls to add a bar chart, then `complete_task`, then a final assistant message. Emit `TEXT_MESSAGE_*` and `TOOL_CALL_*` events from the complete response.
- [ ] **Step 3:** Run in headless Chromium (Playwright), type a prompt in the Studio chat, assert a chart widget appears and the final message renders. Record: exact exported names used, required event sequence, how `complete` must be shaped, how the licence key is set (`AgStudioLicenseManager` / module registry), watermark behaviour without a licence, and how `AgStudio` receives `ai`.
- [ ] **Step 4:** Report findings to `.superpowers/sdd/<plan>/task-1-report.md`. If the contract cannot work with a non-streamed adapter, report the `clientToolRunner` fallback instead. No commit.

---

### Task 2: Sessions, roles and route guards

**Files:**
- Create: `server/src/auth/session.ts`, `server/src/auth/routes.ts`, `server/src/auth/guards.ts`, `server/scripts/hash-password.ts`
- Modify: `server/src/config.ts`, `server/src/app.ts`, `server/src/routes/disputes.ts`, `server/src/routes/actions.ts`, `server/src/routes/webhooks.ts`, `server/package.json` (script `hash-password`), `.env.example`, `render.yaml` (new `sync: false` keys)
- Test: `server/test/auth/session.test.ts`, `server/test/auth/routes.test.ts`, existing route tests updated

**Interfaces:**
- Config: `auth: { owner: Account | null; judge: Account | null; sessionSecret: string | null }`, `type Account = { email: string; passwordHash: string }` from `OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `JUDGE_EMAIL`, `JUDGE_PASSWORD_HASH`, `SESSION_SECRET` (≥ 32 chars when set). Missing pieces disable that account; no secret disables login entirely (login returns 503).
- `hashPassword(password: string): Promise<string>` → `scrypt$<saltB64>$<hashB64>` (N=16384, r=8, p=1, 32-byte key); `verifyPassword(password, stored): Promise<boolean>` (timing-safe).
- `type Role = 'owner' | 'judge'`; `signSession({ role, email }, secret, now): string` → cookie value `base64url(json).base64url(hmacSha256)` with `exp` = now + 8 h; `readSession(value, secret, now): { role: Role; email: string } | null`.
- Cookie `dc_session`: httpOnly, `SameSite=Lax`, `Path=/`, `Secure` when `NODE_ENV=production`, Max-Age 8 h.
- Routes: `POST /auth/login {email, password}` → 200 `{ email, role }` + cookie, 401 `{ error: 'invalid email or password' }` (same body for unknown email and bad password), 429 after 10 failures per IP per 15 min; `POST /auth/logout` → 204 clears cookie; `GET /auth/me` → 200 `{ email, role }` or 401.
- Guards in `guards.ts`: `requireSeller(config)` (cookie any role, or debug token → owner; else 401 `{ error: 'unauthorized' }`), `requireOwner(config)` (owner only; judge → 403 `{ error: 'owner only' }`), `requireSameOrigin(config)` for state-changing seller routes: when a cookie session is used, `Origin` (or `Referer` origin) must equal `PUBLIC_BASE_URL`'s origin, else 403 `{ error: 'bad origin' }`; debug-token requests skip it. `req` gets `res.locals.seller = { role, email }`.
- Apply: `/api/disputes*` GET and approve → `requireSeller` (+ `requireSameOrigin` on approve); sync, settle, `/debug/events` → `requireOwner`. Keep the existing 404-when-no-auth-configured behaviour only for the debug token path.

- [ ] **Step 1: Failing tests:** hash round-trip and wrong password false; session sign/read, tampered → null, expired → null; login success sets cookie with `HttpOnly` and `SameSite=Lax`; unknown email and wrong password give identical 401 bodies; 11th failure → 429; `/auth/me` with/without cookie; judge cookie on settle → 403, on approve → passes guard; approve with judge cookie and `Origin: https://evil.example` → 403 (Review Focus 4); debug token still works everywhere.
- [ ] **Step 2: Run** `npx vitest run test/auth` inside `server/` — FAIL.
- [ ] **Step 3: Implement**, including `npm run hash-password -w server -- '<password>'` printing the hash.
- [ ] **Step 4: Run** full server suite — PASS.
- [ ] **Step 5: Commit** — `feat: owner and judge sessions with role guards`

---

### Task 3: Original amount, dashboard data feed and deadline sweep

**Files:**
- Create: `server/src/db/migrations/003_phase3.sql`, `server/src/routes/dashboard.ts`, `server/src/jobs/deadlineSweep.ts`
- Modify: `server/src/disputes/repo.ts`, `server/src/jobs/handlers.ts`, `server/src/index.ts`, `server/src/app.ts`, `server/src/routes/disputes.ts`
- Test: `server/test/routes/dashboard.test.ts`, `server/test/jobs/deadlineSweep.test.ts`, `server/test/disputes/repo.test.ts`

**Interfaces:**
- Migration 003: `alter table disputes add column original_amount numeric(10,2)`; backfill `update disputes set original_amount = amount where original_amount is null`; `add column deadline_flag text` (`'due_soon' | 'overdue' | null`).
- `upsertDispute` sets `original_amount` on insert only (never overwritten; `coalesce(disputes.original_amount, excluded.amount)` on conflict).
- `GET /api/disputes/:id` gains `originalAmount` and `deadlineFlag`.
- `GET /api/dashboard/data` (`requireSeller`) → `{ generatedAt, sources: { disputes: DisputeRow[], actions: ActionRow[], evidence_gaps: GapRow[] } }`:
  - `DisputeRow = { disputeId, reason, status, localState, originalAmount: number, finalAmount: number | null, amountKept: number | null, currency, responseDueAt: string | null, daysLeft: number | null, deadlineFlag, recommendation: string | null, confidence: number | null, evidenceStrength: string | null, outcome: string | null, createdAt: string }`. `amountKept` only when RESOLVED: `originalAmount - refunded`, where refunded = current PayPal amount for buyer-favour outcomes and 0 for seller-favour outcomes. Numbers are JSON numbers (AG Studio aggregates them).
  - `ActionRow = { disputeId, type, state, createdAt, sentAt }`, `GapRow = { disputeId, requirement }` from the latest analysis' `missing_evidence`.
- `deadlineSweepJob(deps: { db; now }): JobHandler` — sets `deadline_flag` for open disputes (`local_state` not RESOLVED): `overdue` if `response_due_at < now`, `due_soon` if within 72 h, else null; then enqueues the next `deadlineSweep` at now + 1 h (only if none queued). `index.ts` enqueues one on startup if none queued.

- [ ] **Step 1: Failing tests:** original amount kept after an update that changes amount to 12.50; feed shapes and numeric types; `amountKept` 12.5 for the Oct 27 case (original 25, PayPal 12.50, RESOLVED_BUYER_FAVOUR) and 25 for seller-favour; judge cookie can read the feed, no cookie → 401; sweep flags at 71 h and past due, clears for RESOLVED, reschedules exactly one job.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** full suite — PASS.
- [ ] **Step 5: Commit** — `feat: keep original amounts, dashboard data feed and hourly deadline sweep`

---

### Task 4: Agent model proxy

**Files:**
- Create: `server/src/ai/chatCompletions.ts`, `server/src/routes/agent.ts`
- Modify: `server/src/app.ts`, `server/src/config.ts` (no new keys; reuse `llm`)
- Test: `server/test/ai/chatCompletions.test.ts`, `server/test/routes/agent.test.ts`

**Interfaces:**
- Use Task 1's findings for the wire shape. Default design: the browser adapter POSTs the `AgLlmRequest` JSON (`{ input, instructions, tools, toolChoice, responseFormat }`) to `POST /api/agent/turn`; the server returns an `AgLlmResponse` JSON (`{ id, createdAt, status, output, model }`), non-streamed.
- `toChatMessages(req): OpenAIMessage[]` maps `input` items: user/system messages → `{role, content}`; assistant `message` → `{role:'assistant', content}`; `function_call` items → assistant `tool_calls`; `function_call_output` → `{role:'tool', tool_call_id, content}`; `reasoning` items dropped. `tools` → OpenAI `tools[]` (`type: 'function'`, `function: { name, description, parameters }`); `toolChoice` mapped; `responseFormat.type === 'json'` → `response_format: { type: 'json_object' }`.
- `fromChatCompletion(choice, model): AgLlmResponse` maps back: text → output `message` item; `tool_calls` → `function_call` items (`callId` = OpenAI id, `arguments` string), status `completed`.
- `callChatCompletions(opts: { gemini; groq; timeoutMs; fetchImpl? }, body): Promise<{ data; model }>`: Gemini via `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` (Bearer key), then Groq `https://api.groq.com/openai/v1/chat/completions`; same skip/fallback rules and reason codes as `llm.ts`; throws `LlmUnavailableError`.
- Route: `requireSeller`; body limit 200 KB; 20 requests per minute per session (or per IP for debug token) → 429; email redaction on all text content before sending; 503 `{ error: 'analyst unavailable' }` on `LlmUnavailableError` (Review Focus 3); logs only reason codes.

- [ ] **Step 1: Failing tests:** mapping round-trips (user + function_call + function_call_output sequence; tool_calls back to items); Gemini 500 → Groq used; both down → 503 body; 21st request in a minute → 429; email in user text not in outgoing body; no session → 401.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat: agent model proxy for the Studio Agent Framework`

---

### Task 5: Live-test fixes and serving the web app

**Files:**
- Modify: `server/src/agent/letter.ts`, `server/src/ai/llm.ts`, `server/src/jobs/analyzeDispute.ts`, `server/src/app.ts`, root `package.json`, `server/package.json`
- Create: `server/src/web/static.ts`, `server/src/web/securityHeaders.ts`
- Test: `server/test/agent/letter.test.ts`, `server/test/ai/llm.test.ts`, `server/test/web/static.test.ts`

**Interfaces:**
- Letter: system rule "Never claim what the buyer asked for, requested, agreed to or said unless a listed fact states it." Validation: reject (`LetterRejectedError('unsupported claim about the buyer')`) when the letter matches `/\byou (requested|asked for|agreed)\b|\byour request(ed)?\b/i` and no fact id starting `dispute.buyer_message` or `message.` is cited.
- `llm.ts`: on a successful fallback, `generateJson` result gains `fallbackReasons: string[]` (e.g. `['gemini:http_400']`); `analyzeDispute` logs `ai fallback: <codes>` (codes only). Investigate the Oct 27 Gemini failure with a fake fetch reproducing Gemini 3.6 responses (thinking models may return `parts[0]` as a thought part): read the first part whose `text` is a string and that is not `thought: true`. Add a test for that response shape.
- `serveWeb(app, opts: { distDir: string })` in `static.ts`: `express.static(distDir, { index: false, maxAge: '1h', immutable for /assets })`; GET requests not starting with `/api`, `/auth`, `/webhooks`, `/store`, `/debug`, `/health` and accepting HTML → `index.html`; if `distDir` missing, skip with one log line (tests and API-only runs).
- `securityHeaders()` middleware: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, CSP `default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'` (relax only if Task 1 shows AG Studio needs more, and say why).
- Root `package.json`: workspaces `["server", "web"]`; `build` = `npm run build -w server && npm run build -w web && node -e "<copy web/dist to server/dist/web>"`; server reads `distDir = new URL('./web/', import.meta.url)` at runtime.

- [ ] **Step 1: Failing tests** for the letter rule (the exact Oct 27 sentence "which matches the amount you requested" rejected; allowed when a buyer message fact is cited), the thought-part Gemini response, SPA fallback (`/dashboard` → index.html, `/api/x` → JSON 404, `/store` untouched), headers present.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** full suite — PASS.
- [ ] **Step 5: Commit** — `fix: tighter letter rules, Gemini thought parts, serve the web app`

---

### Task 6: Web app shell, Kaala themes and public pages

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles/kaala/` (controller supplies `tokens.css` and `kaala.css` from the Kaala artifact), `web/src/styles/app.css`, `web/src/lib/api.ts`, `web/src/lib/auth.tsx`, `web/src/lib/theme.ts`, `web/src/components/{TopBar,Footer,ThemeSwitch,WakingUp,ErrorBoundary,Toast}.tsx`, `web/src/pages/{Home,Guide,Login,Privacy,Terms,NotFound,ErrorPage}.tsx`, `web/public/favicon.svg`
- Test: `web/src/**/*.test.tsx`

**Interfaces:**
- `api<T>(path, init?): Promise<T>` with `credentials: 'same-origin'`, JSON; 401 → throws `UnauthorizedError`; network failure or 502/503 during startup → `WakingUpError`.
- `AuthProvider` + `useAuth(): { user: {email, role} | null; loading; login(email, password); logout() }`; `RequireAuth` redirects to `/login?next=<path>`; Login navigates to `next` on success (Review Focus 1).
- `theme.ts`: `getInitialTheme(): 'night' | 'day'` (localStorage `kaala-theme`, else `prefers-color-scheme`, else night), `applyTheme(t)` sets `data-theme`.
- Routes: `/`, `/guide`, `/login`, `/dashboard` (placeholder until Task 8), `/disputes/:id` (placeholder until Task 7), `/privacy`, `/terms`, `*` → NotFound; `ErrorBoundary` renders ErrorPage with a reference code (`Date.now().toString(36)`).
- Copy: plain words, no em/en dashes, no emoji. Guide lists the walkthrough and shows judge login and sandbox buyer email from build-time env `VITE_JUDGE_EMAIL`, `VITE_JUDGE_PASSWORD`, `VITE_SANDBOX_BUYER_EMAIL`, `VITE_SANDBOX_BUYER_PASSWORD` (judge-only sandbox accounts; documented as public).
- `WakingUp`: shown while `/health` fails, retries every 3 s, text "Starting the demo server, this takes about 30 seconds."

- [ ] **Step 1: Failing tests:** theme initial choice and switch persistence; RequireAuth redirect with `next`; login success navigates to `next`; NotFound renders a home link; ErrorBoundary shows reference code; WakingUp shows then hides when `/health` succeeds (fake timers).
- [ ] **Step 2: Run** `npm test -w web` — FAIL. **Step 3: Implement.** **Step 4: Run** tests + `npm run build` at root — PASS; Playwright screenshot of `/` and `/guide` in night and day at 1280px and 390px saved to the report, no horizontal scroll at 390px.
- [ ] **Step 5: Commit** — `feat: web app shell with Kaala themes, login and public pages`

---

### Task 7: Review page

**Files:**
- Create: `web/src/pages/Review.tsx`, `web/src/components/review/{EvidenceChecklist,RecommendationCard,LetterEditor,ActionTimeline,ManualBanner,ConfirmDialog}.tsx`
- Test: `web/src/pages/Review.test.tsx`

**Interfaces:**
- Data: `GET /api/disputes/:id` (Phase 2 shape plus `originalAmount`, `deadlineFlag`); `POST /api/disputes/:id/approve { action, note, offerAmount? }`.
- Action picker shows only allowed actions; recommended preselected; OFFER shows amount input prefilled with `suggestedOffer`; note prefilled with `letterDraft`, live character count, 20 to 2000 limit.
- Approve opens ConfirmDialog restating action, amount and that it goes to PayPal; confirm → POST; button disabled while pending; 202 → toast "Sent to PayPal queue" and polling; 409 `action already pending` → "An action is already pending" (Review Focus 2); 409 `not ready` → "This dispute changed, reloading"; 409 `action not allowed now` → "PayPal no longer allows this action" and refresh; 400 → field error.
- Polls every 5 s while `localState` is `ANALYZING` or `ACTION_PENDING`; stops otherwise.
- ManualBanner texts by `manualReason` prefix: `AI draft unavailable` → "The AI could not draft a letter. Write it yourself and approve."; `PayPal rejected the action` → "PayPal rejected the last action. Check the case in PayPal before approving again."; `no matching order` → "We could not match this dispute to a store order."; `No PayPal action is open` → "PayPal has no action open for you right now."; other → the reason text. Review Focus 5.

- [ ] **Step 1: Failing tests** with mocked fetch: READY renders recommendation and letter; NEEDS_MANUAL without analysis renders banner and empty editor; approve flow posts the exact body; double click sends one request; each 409 message; polling stops after ACTION_SENT.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** tests + build — PASS; screenshots night/day/390px.
- [ ] **Step 5: Commit** — `feat: review page with confirm, timeline and plain-language errors`

---

### Task 8: AG Studio dashboard with custom widgets

**Files:**
- Create: `web/src/pages/Dashboard.tsx`, `web/src/studio/{studioTheme.ts,dataSources.ts,layout.ts,license.ts}`, `web/src/studio/widgets/{ActionNeededWidget.tsx,MoneyProtectedWidget.tsx,index.ts}`
- Test: `web/src/studio/*.test.ts`, `web/src/pages/Dashboard.test.tsx`

**Interfaces:**
- `license.ts`: sets the key from `import.meta.env.VITE_AG_STUDIO_LICENSE_KEY` using the API Task 1 found; absent key → trial watermark accepted in dev.
- `dataSources.ts`: `toStudioData(feed): AgDataSourcesDefinition` with sources `disputes`, `actions`, `evidence_gaps` and field formats (currency for amounts, dates for `responseDueAt`/`createdAt`).
- `studioTheme.ts`: `kaalaStudioTheme(theme: 'night' | 'day')` built with `createStudioTheme` from Kaala token values read via `getComputedStyle` (fonts Manrope/JetBrains Mono, surfaces, lines, ink, violet accent); re-applied on theme switch.
- `layout.ts`: initial report state with widgets 1 to 5 from spec §5 in a two-column grid (Action needed and Money protected first row).
- Custom widgets registered via the `widgets` property (React components through `ag-studio-react` custom widget API): Action needed (sorted by `daysLeft`, countdown text, warning/danger colours by `deadlineFlag`, link to `/disputes/:id`), Money protected (sum of `amountKept` vs refunded over RESOLVED rows, empty state "No resolved disputes yet").
- `AgStudio` in `view` mode with an "Edit layout" toggle (owner and judge both allowed; changes not persisted).

- [ ] **Step 1: Failing tests:** `toStudioData` types and formats; Money protected sums 12.5 kept / 12.5 refunded for the Oct 27 row and shows the empty state with no resolved rows; Action needed orders by days left and links correctly; theme function returns different canvas colours for night and day.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** tests + build — PASS; Playwright screenshot of the dashboard with seeded data in night and day.
- [ ] **Step 5: Commit** — `feat: AG Studio dashboard with Kaala theme and custom widgets`

---

### Task 9: Dispute Analyst agent

**Files:**
- Create: `web/src/studio/agent/{adapter.ts,analyst.ts,harness.ts}`
- Modify: `web/src/pages/Dashboard.tsx`
- Test: `web/src/studio/agent/*.test.ts`

**Interfaces:**
- `createProxyAdapter(fetchImpl = fetch): AgLlmAdapter` — POSTs to `/api/agent/turn`, turns the JSON `AgLlmResponse` into the event stream Task 1 recorded; 503/429 → a final assistant message "Analyst unavailable, try again shortly." (Review Focus 3).
- `disputeAnalyst(ctx)` definition: id `dispute-analyst`, name "Dispute Analyst", instructions from spec §7 (data only, no invented numbers, never advise approving, delegate chart and widget work), tools `studio.viewSchema()`, `studio.executeQuery()`, `tools.delegateTo(['data', 'widget', 'page'])`, `maxTurns` 12.
- `buildHarness(api)`: `createAiHarness(api, ({ tools, builtIn }) => ({ agents: [analystRunner, ...['data','widget','page','planning'].map(id => directLlmRunner({ ...builtIn[id], adapter }))], primary: 'dispute-analyst', promptStarters: [ "Which disputes are due this week?", "How much money have we kept?", "Chart outcomes by recommendation" ] }))`.

- [ ] **Step 1: Failing tests:** adapter maps a tool-call response to the recorded event sequence; 503 → unavailable message; harness lists `dispute-analyst` as primary and the prompt starters.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** tests + build — PASS; Playwright run with a stubbed `/api/agent/turn` that scripts a delegate-to-widget flow → a new chart appears.
- [ ] **Step 5: Commit** — `feat: Dispute Analyst agent working with Studio's built-in agents`

---

### Task 10: Store restyle, docs and deploy config

**Files:**
- Modify: `server/src/store/pages.ts` (Kaala tokens inline via a shared `<link>` to `/assets` CSS or an inline token block; night/day via `prefers-color-scheme`), `README.md`, `docs/runbooks/sandbox-dispute.md`, `render.yaml`, `.env.example`, main spec §5/§6/§14 (frontend and auth decisions)
- Test: `server/test/routes/store.test.ts` (pages still escape HTML and render products)

**Interfaces:**
- `render.yaml` adds `sync: false` keys: `OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `JUDGE_EMAIL`, `JUDGE_PASSWORD_HASH`, `SESSION_SECRET`, `VITE_AG_STUDIO_LICENSE_KEY`, `VITE_JUDGE_EMAIL`, `VITE_JUDGE_PASSWORD`, `VITE_SANDBOX_BUYER_EMAIL`, `VITE_SANDBOX_BUYER_PASSWORD`. Build command unchanged (`npm ci --include=dev && npm run build`).
- README: what it is, live URL, judge login pointer to `/guide`, architecture diagram (text), env table, how to run locally, how to make password hashes.

- [ ] **Step 1: Update store tests** for new markup (still lists 3 products, escapes HTML). **Step 2: Run** — FAIL. **Step 3: Implement + docs.** **Step 4: Run** all tests + root build — PASS; copy check: `grep -rnP "—|–" web/src server/src/store README.md docs/runbooks` returns nothing.
- [ ] **Step 5: Commit** — `feat: Kaala store pages; docs: Phase 3 setup, judge guide and deploy keys`

**Milestone check (Asana "Full product live on Render", Nov 6):** on Render, a judge in a fresh browser follows `/guide` end to end in night and day, at 390px, keyboard only: buy, dispute, dashboard shows it in Action needed, Review shows the recommendation, approve, buyer accepts, dashboard Money protected updates, Dispute Analyst answers "Which disputes are due this week?" and adds a chart.
