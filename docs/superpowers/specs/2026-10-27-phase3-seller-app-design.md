# Dispute Copilot Phase 3: Seller App Design

Status: Draft for Sri's review · Date: 2026-10-27 · Builds on: `2026-10-13-dispute-copilot-design.md` (the main spec)
Deadline: submit Nov 11, 2026 (cutoff Nov 12, 12:00 pm PT). Judging Dec 1 to 15; the demo must work for judges until Dec 15.

## 1. Goal

Turn the working API (Phases 0 to 2, proven live on Oct 27: store purchase, dispute, evidence, AI recommendation, approval, PayPal action, buyer accepts, RESOLVED) into a product a judge can use in a browser, and enter the **Best Use of AG Grid** prize.

Every choice is checked against the five equally weighted judging criteria and the AG Grid prize focus:

| Criterion | What Phase 3 must show |
|---|---|
| Technological Implementation | Real PayPal flow and real AI in the UI, with visible, robust failure handling |
| Design | A finished product: clear journey, helpful feedback, accessibility, polish |
| Potential Impact | Real before/after numbers: money kept, deadlines met |
| Innovation | An agent that analyses and explains disputes, not a chatbot bolted onto payments |
| Presentation | A reliable, repeatable demo path for judges and the 3 minute video |
| AG Grid prize | AG Studio with custom widgets, theming and layout, plus the Studio Agent Framework (a custom agent working with Studio's built-in agents) |

## 2. Decisions (Sri, Oct 27)

1. Compete for Best Use of AG Grid with AG Studio + Studio Agent Framework. 45-day trial licence started on or after Oct 31 (covers judging to Dec 14).
2. Custom agent: **Dispute Analyst**, read-only analysis in plain English; it hands chart and widget building to Studio's built-in agents and can never approve or send anything.
3. Screens: **Dashboard home** (AG Studio) plus a separate **Review page** for one dispute.
4. Access: one login page, two accounts from env vars: **owner** (Sri, full access) and **judge** (published in the submission and on the guide page). The judge cannot use admin actions (sync all, sandbox settle, debug events); everything else is allowed.
5. Hosting: stay on Render's free web plan for now; upgrade the web service to Starter around Nov 9 (Asana reminder). Postgres stays Basic-256mb.
6. Theme: Sri's Kaala design system, Night (dark) and Day (light), following the device setting with a manual switch; default dark.
7. Sri delegated remaining design decisions to Claude; crucial inputs (accounts, money, prize strategy) still go to Sri.

## 3. Architecture

One Render web service, as today. A new `web/` package (React 18 + Vite + TypeScript) is built to static files and served by the existing Express server, so there is one URL and same-site cookies.

```
browser ── /, /guide, /login, /dashboard, /disputes/:id, /privacy, /terms (React app, static)
        ── /store/* (existing server-rendered store, restyled with Kaala)
        ── /auth/*, /api/* (Express)
                 │
   Express ──────┼── auth (session cookie)          new
                 ├── /api/disputes* (Phase 2)       now also accepts the session cookie
                 ├── /api/dashboard/data            new, read-only rows for AG Studio
                 ├── /api/agent/chat                new, model proxy for the Studio agent
                 └── worker (inline): processDispute, analyzeDispute, executeAction, deadlineSweep (new, hourly)
```

npm workspaces: root `package.json` gains `web`; `npm run build` builds `server` then `web` and copies `web/dist` where Express serves it (`express.static` + SPA fallback for unknown non-API GETs). Render build command is unchanged.

## 4. Pages

| Route | Access | Content |
|---|---|---|
| `/` Home | public | What Dispute Copilot does in plain words, a short before/after, buttons **Try the seller demo** and **Open the demo store** |
| `/guide` Judge guide | public | Numbered demo walkthrough (buy, open dispute as sandbox buyer, wait about 5 minutes, review, approve, buyer accepts, RESOLVED), the judge login, and the sandbox buyer test account (sandbox only) |
| `/login` | public | Email + password, returns to the page you came from |
| `/dashboard` | signed in | AG Studio dashboard (section 5) + Dispute Analyst panel |
| `/disputes/:id` Review | signed in | Section 6 |
| `/privacy`, `/terms` | public | Short, honest pages: sandbox demo, what is stored, no real customers; linked in the footer |
| 404 | public | Friendly not-found with a link home |
| Error page | public | "Something went wrong", **Try again**, a short reference code, no technical details |
| `/store`, `/store/return`, `/store/cancel` | public | Existing pages restyled with Kaala tokens |

Top bar on every page: wordmark, nav (signed in: Dashboard; public: Guide, Store), theme switch (Night/Day), sign in/out. Footer: Privacy, Terms, "Sandbox demo, no real money".

## 5. Dashboard (AG Studio)

`ag-studio-react` `AgStudio` component, preset layout in **view** mode for judges (edit mode available via a toggle), themed from Kaala tokens in both themes. Data comes from `GET /api/dashboard/data` as AG Studio sources:

- `disputes`: id, reason, status, localState, originalAmount, currency, responseDueAt, daysLeft, recommendation, confidence, evidenceStrength, outcome, createdAt
- `actions`: disputeId, type, state, createdAt, sentAt
- `evidence_gaps`: disputeId, requirement (one row per missing requirement)

Widgets:

1. **Action needed** (custom widget): open disputes sorted by deadline, countdown text ("3 days left"), warning colour under 3 days, danger when overdue, link **Open review**.
2. **Money protected** (custom widget): sums over resolved disputes of amount kept vs refunded (original amount minus refund). Real data only; shows an empty state until a dispute resolves.
3. **Recommendations**: AG chart, FIGHT / OFFER / ACCEPT split with average confidence.
4. **Outcomes over time**: AG chart of resolved disputes by result.
5. **Evidence gaps**: AG chart of the most common missing evidence.
6. **Dispute Analyst** panel (section 7).

Additional widgets are added only if they earn their place during the build.

## 6. Review page

For one dispute:

- Header: amount, reason, PayPal status, deadline countdown, local state badge.
- **Evidence checklist** (present / missing) and the fact list.
- **Recommendation** card: action, confidence, evidence strength, reasons, flags (e.g. "Downgraded from FIGHT: missing delivery confirmation"), suggested offer.
- **Letter** in an editable textarea (20 to 2000 characters), offer amount input when OFFER.
- Action picker limited to `allowedActions`; the recommended one preselected.
- **Approve** (the one primary button) opens a confirm dialog that restates exactly what will be sent to PayPal. Then a toast and the action timeline: PENDING, SENT or FAILED with the reason.
- `NEEDS_MANUAL` banner explaining what happened and what to do (e.g. "AI draft unavailable: write the letter yourself and approve", "PayPal rejected the action: check the case in PayPal before approving again").
- Polls every 5 seconds while the state is ANALYZING or ACTION_PENDING.

## 7. Dispute Analyst (Studio Agent Framework)

- A custom primary agent `dispute-analyst` registered with `createAiHarness`. Instructions: answer questions about the seller's disputes from data only, never invent numbers, never advise approving; delegate chart and widget creation to Studio's built-in agents via `tools.delegateTo([...])`; may use `studio.viewSchema()` and `studio.executeQuery()`.
- Model calls go through an adapter that posts to **`POST /api/agent/chat`** on our server, which uses the existing Gemini then Groq wrapper. Keys never reach the browser. The endpoint is signed-in only, rate limited (20 requests per minute per session), caps prompt size, redacts emails, and returns a plain "Analyst unavailable" message when both providers fail.
- Example prompts shown as chips: "Which disputes are due this week?", "How much money have we kept?", "Chart outcomes by recommendation".
- Risk: the exact adapter contract is not fully documented. The plan starts with a throwaway spike that connects AG Studio's agent to `/api/agent/chat`; if it cannot work, the fallback is `clientToolRunner` with our endpoint running the loop, and the spec is updated.

## 8. Auth

- Env: `OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `JUDGE_EMAIL`, `JUDGE_PASSWORD_HASH`, `SESSION_SECRET`. Hashes made with Node's built-in `scrypt` (no new dependency); a small script prints a hash.
- `POST /auth/login` (rate limited, constant-time compare, generic error), `POST /auth/logout`, `GET /auth/me` returns `{ email, role }`.
- Session: signed, httpOnly, `SameSite=Lax`, `Secure` in production cookie holding `{ role, exp }` (8 hours). No server session store needed.
- `/api/disputes*`, `/api/dashboard/*`, `/api/agent/*` accept the session cookie (any role) or the existing `x-debug-token`. Owner-only: `POST /api/disputes/sync`, `POST /api/disputes/:id/sandbox/settle`, `/debug/events`. Approve accepts a JSON body only and checks the `Origin` header against `PUBLIC_BASE_URL` (CSRF guard).

## 9. Server changes

1. **Original amount kept**: new `disputes.original_amount`, set on first insert and never overwritten; dashboard and Money protected use it.
2. **Letter prompt tightened**: never state what the buyer asked for or agreed to unless a fact says so; validation rejects letters containing "you requested" style claims when no buyer-message fact supports them.
3. **Gemini fallback investigated**: log the Gemini reason code on success via Groq; fix the cause (model id, timeout or request shape).
4. **Deadline sweep**: hourly job `deadlineSweep` sets `due_soon` (within 3 days) and `overdue` flags used by the dashboard and Review page.
5. **Static web serving** with SPA fallback; API 404s stay JSON.
6. **Security headers** (CSP allowing Google Fonts, `X-Content-Type-Options`, `Referrer-Policy`, frame-ancestors none) without a new dependency.

## 10. Errors and empty states

Waking-up screen on first load (free Render plan), loading skeletons, empty states with a link to the guide, session expired redirect with return path, plain-words errors with retry, toasts for actions. No raw stack traces or PayPal bodies in the UI.

## 11. Testing

- Server: vitest + supertest for auth, dashboard data shape, agent proxy (fake LLM), deadline sweep, original amount, letter validation.
- Web: vitest + React Testing Library for Review page states (READY, ANALYZING, ACTION_PENDING, FAILED, NEEDS_MANUAL), login redirect, theme switch.
- Manual: the judge guide walkthrough on Render in Night and Day, at 390px phone width, keyboard only, before the milestone.

## 12. Milestones (Asana due dates)

| Date | Milestone |
|---|---|
| Oct 31 | Start AG Studio trial; agent spike done |
| Nov 2 | AG Studio dashboard with widgets |
| Nov 3 | Review and approve screen |
| Nov 4 | Deadline watcher |
| Nov 5 | Deployed on Render |
| Nov 6 | **Full product live on Render**; accessibility and copy pass |
| Nov 7 to 9 | README, pitch numbers, video script and recording, security check, upgrade web to Starter |
| Nov 10 | Fresh-browser judge test, fixes |
| Nov 11 | Submit |

## 13. Out of scope

Sign-up, password reset, account settings, email/SMS alerts, multi-seller accounts, custom domain (optional, flagged against the Kaala launch checklist), prevention agent and Elastic search unless ahead of schedule at the Nov 1 check.
