import { isFinalStatus, type TrackingView } from '../carrier/sandboxCarrier.js';
import { PRODUCTS } from './repo.js';

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Kaala tokens, copied from web/src/styles/kaala/tokens.css (only what the store uses).
// Night is the default. Day applies with data-theme="day" (set by /theme-init.js from the web
// build) and, when that script is missing or has not run, from the device's light setting.
const DAY_TOKENS = `
  color-scheme: light;
  --canvas: #f5f5f7;
  --surface-1: #ffffff;
  --surface-2: #ececef;
  --surface-3: #e2e2e6;
  --line: #e4e4e8;
  --line-strong: #d1d1d7;
  --line-control: #77777f;
  --ink: #111113;
  --ink-2: #4f4f57;
  --ink-3: #5f5f67;
  --primary: #111113;
  --on-primary: #fafafa;
  --secondary-ink: #5a50c8;
  --secondary-soft: rgba(139, 131, 230, 0.16);
  --success: #15703f;
  --warning: #9c4c0e;
  --danger: #b52b2b;
  --info-soft: rgba(36, 95, 174, 0.10);
  --edge: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 1px 2px rgba(17, 17, 19, 0.06);
  --focus: 0 0 0 2px #f5f5f7, 0 0 0 4px #5a50c8;`;

const CSS = `
  :root {
    color-scheme: dark;
    --font-sans: "Manrope", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    --font-brand: "Schibsted Grotesk", "Manrope", system-ui, sans-serif;
    --font-display: "Bricolage Grotesque", "Manrope", system-ui, sans-serif;
    --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 20px;
    --space-6: 24px; --space-8: 32px; --space-12: 48px;
    --radius-md: 10px; --radius-lg: 16px;
    --canvas: #0a0a0b;
    --surface-1: #111113;
    --surface-2: #18181b;
    --surface-3: #212125;
    --line: #26262b;
    --line-strong: #3a3a40;
    --line-control: #66666e;
    --ink: #ededef;
    --ink-2: #a1a1a8;
    --ink-3: #8a8a92;
    --primary: #ededef;
    --on-primary: #0a0a0b;
    --secondary-ink: #8b83e6;
    --secondary-soft: rgba(139, 131, 230, 0.12);
    --success: #5bc489;
    --warning: #f08c4a;
    --danger: #f06a6a;
    --info-soft: rgba(106, 168, 240, 0.12);
    --edge: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    --focus: 0 0 0 2px #0a0a0b, 0 0 0 4px #8b83e6;
  }
  [data-theme="day"] {${DAY_TOKENS}
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme]) {${DAY_TOKENS}
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { background: var(--canvas); color: var(--ink); }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; font-family: var(--font-sans); font-size: 15px; line-height: 24px; font-weight: 450; letter-spacing: .01em; -webkit-font-smoothing: antialiased; }
  a { color: var(--secondary-ink); text-underline-offset: 3px; }
  a:hover { color: var(--ink); }
  :where(a, button, input, select):focus-visible { outline: none; box-shadow: var(--focus); border-radius: var(--radius-md); }
  .topbar { border-bottom: 1px solid var(--line); background: var(--canvas); }
  .topbar__in { max-width: 960px; margin: 0 auto; padding: 0 var(--space-4); height: 56px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
  .wordmark { font-family: var(--font-brand); font-size: 20px; line-height: 24px; font-weight: 800; letter-spacing: -0.04em; word-spacing: .12em; color: var(--ink); text-decoration: none; }
  .wordmark:hover { color: var(--ink); }
  .eyebrow { font-family: var(--font-mono); font-size: 11px; line-height: 16px; font-weight: 500; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); }
  main { flex: 1; width: 100%; max-width: 960px; margin: 0 auto; padding: var(--space-8) var(--space-4) var(--space-12); }
  h1 { font-family: var(--font-display); font-size: 32px; line-height: 38px; font-weight: 600; letter-spacing: -0.02em; margin: var(--space-2) 0 var(--space-1); }
  .sub { color: var(--ink-2); margin: 0 0 var(--space-6); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--space-4); }
  .card, .panel { background: var(--surface-1); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--edge); padding: var(--space-5); }
  .panel { max-width: 560px; padding: var(--space-6); }
  .card { display: flex; flex-direction: column; }
  .card h2 { font-size: 18px; line-height: 26px; font-weight: 600; letter-spacing: -0.005em; margin: 0 0 var(--space-2); overflow-wrap: anywhere; }
  .price { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 22px; line-height: 28px; font-weight: 500; letter-spacing: -0.02em; margin: 0 0 var(--space-5); }
  .card form { margin-top: auto; }
  .btn { font: 600 13px/18px var(--font-sans); letter-spacing: .01em; display: inline-flex; align-items: center; justify-content: center; height: 36px; padding: 0 var(--space-4); border-radius: var(--radius-md); border: 1px solid var(--line-strong); background: var(--surface-2); color: var(--ink); box-shadow: var(--edge); cursor: pointer; transition: background 160ms cubic-bezier(.2,.8,.2,1), border-color 160ms cubic-bezier(.2,.8,.2,1); }
  .btn:hover { background: var(--surface-3); border-color: var(--line-control); }
  .btn:focus-visible { box-shadow: var(--focus); }
  .card .btn { width: 100%; }
  .note { display: flex; flex-direction: column; gap: var(--space-1); margin: var(--space-6) 0 0; padding: var(--space-4); border: 1px solid var(--line); border-left: 2px solid var(--secondary-ink); border-radius: var(--radius-md); background: var(--secondary-soft); }
  .note p { margin: 0; color: var(--ink); }
  .panel h1 { margin-top: 0; }
  .panel p { margin: 0 0 var(--space-3); color: var(--ink-2); }
  .panel p:last-child { margin-bottom: 0; }
  code { font-family: var(--font-mono); font-size: 13px; background: var(--surface-2); border: 1px solid var(--line); padding: 1px 6px; border-radius: 4px; overflow-wrap: anywhere; }
  .footer { border-top: 1px solid var(--line); }
  .footer__in { max-width: 960px; margin: 0 auto; padding: var(--space-4); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-4); color: var(--ink-3); font-size: 13px; line-height: 18px; }
  .footer nav { display: flex; gap: var(--space-4); }
  @media (max-width: 480px) {
    .topbar__right .eyebrow { display: none; }
    .nav { gap: var(--space-3); }
    h1 { font-size: 26px; line-height: 32px; }
    main { padding-top: var(--space-6); }
  }
  .topbar__right { display: flex; align-items: center; gap: var(--space-4); }
  .nav { display: flex; align-items: center; gap: var(--space-4); font-size: 13px; line-height: 18px; }
  .nav a { color: var(--ink-2); text-decoration: none; }
  .nav a:hover { color: var(--ink); }
  .field { display: flex; flex-direction: column; gap: var(--space-1); margin: 0 0 var(--space-3); }
  .field label { font-size: 12px; line-height: 16px; color: var(--ink-3); }
  select, input[type="text"] { font: 500 13px/18px var(--font-sans); width: 100%; height: 36px; padding: 0 var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--line-control); background: var(--surface-2); color: var(--ink); }
  .lookup { display: flex; gap: var(--space-2); margin: 0 0 var(--space-4); }
  .lookup input { flex: 1; min-width: 0; }
  .badge { display: inline-flex; align-items: center; height: 24px; padding: 0 var(--space-3); border-radius: 999px; font: 600 12px/16px var(--font-sans); border: 1px solid var(--line-strong); background: var(--surface-2); color: var(--ink); }
  .badge--ok { color: var(--success); border-color: var(--success); }
  .badge--bad { color: var(--danger); border-color: var(--danger); }
  .track { max-width: 640px; }
  .track__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); margin: 0 0 var(--space-4); }
  .track__num { font-family: var(--font-mono); font-size: 13px; overflow-wrap: anywhere; color: var(--ink-2); }
  .proof { margin: 0 0 var(--space-5); padding: var(--space-4); border: 1px solid var(--line); border-left: 2px solid var(--success); border-radius: var(--radius-md); background: var(--surface-2); }
  .proof--bad { border-left-color: var(--danger); }
  .proof h2 { margin: 0 0 var(--space-2); font-size: 15px; line-height: 22px; font-weight: 600; }
  .proof p { margin: 0; color: var(--ink-2); }
  .proof dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: var(--space-1) var(--space-4); }
  .proof dt { color: var(--ink-3); }
  .proof dd { margin: 0; overflow-wrap: anywhere; }
  .events { list-style: none; margin: 0; padding: 0; border-left: 1px solid var(--line-strong); }
  .events li { position: relative; padding: 0 0 var(--space-4) var(--space-5); }
  .events li::before { content: ""; position: absolute; left: -5px; top: 8px; width: 9px; height: 9px; border-radius: 50%; background: var(--line-control); }
  .events li.is-latest::before { background: var(--secondary-ink); box-shadow: 0 0 0 3px var(--secondary-soft); }
  .events strong { display: block; font-weight: 600; }
  .events .when { font-family: var(--font-mono); font-size: 12px; line-height: 16px; color: var(--ink-3); }
  .events .where { color: var(--ink-2); font-size: 13px; }
  .sim-note { margin: var(--space-5) 0 0; color: var(--ink-3); font-size: 13px; line-height: 18px; }
  @media (prefers-reduced-motion: reduce) { .btn { transition: none; } }
`;

// Same families as web/src/styles/kaala/kaala.css, so the store matches the web app.
const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Manrope:wght@400..800&family=JetBrains+Mono:wght@400;500;600&family=Schibsted+Grotesk:wght@400..900&display=swap';

function layout(title: string, body: string, headExtra = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="Sandbox demo store and parcel tracking for Dispute Copilot. No real money moves.">
<script src="/theme-init.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${escapeHtml(FONTS_URL)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${headExtra}
<style>${CSS}</style>
</head>
<body>
<header class="topbar">
  <div class="topbar__in">
    <a class="wordmark" href="/">Dispute Copilot</a>
    <div class="topbar__right">
      <span class="eyebrow">Demo store</span>
      <nav class="nav" aria-label="Main">
        <a href="/store">Store</a>
        <a href="/track">Track</a>
        <a href="/guide">Guide</a>
      </nav>
    </div>
  </div>
</header>
<main>
${body}
</main>
<footer class="footer">
  <div class="footer__in">
    <span>Sandbox demo, no real money</span>
    <nav aria-label="Legal">
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </nav>
  </div>
</footer>
</body>
</html>
`;
}

export function storePage(): string {
  const cards = PRODUCTS.map(
    (p) => `<div class="card">
  <h2>${escapeHtml(p.name)}</h2>
  <p class="price">$${escapeHtml(p.price)}</p>
  <form method="post" action="/store/checkout">
    <input type="hidden" name="productId" value="${escapeHtml(p.id)}">
    <div class="field">
      <label for="delivery-${escapeHtml(p.id)}">Sandbox carrier will</label>
      <select id="delivery-${escapeHtml(p.id)}" name="delivery">
        <option value="DELIVERED">Deliver it, with a signature</option>
        <option value="LOST">Lose the package</option>
      </select>
    </div>
    <button class="btn" type="submit">Buy with PayPal</button>
  </form>
</div>`,
  ).join('\n');
  return layout(
    'Dispute Copilot Demo Store',
    `<h1>Dispute Copilot Demo Store</h1>
<p class="sub">A sandbox shop. Pick an item to start a PayPal checkout.</p>
<div class="grid">
${cards}
</div>
<div class="note">
  <p>Sandbox demo. Pay with the sandbox buyer account from the guide. No real money moves.</p>
  <p>The sandbox carrier tracks every order on a fast clock: it delivers in about a minute and a half, or loses the package. Follow it on the <a href="/track">tracking page</a>.</p>
  <p><a href="/guide">Open the guide</a></p>
</div>`,
  );
}

export function thankYouPage(orderId: string, trackingNumber?: string): string {
  return layout(
    'Thank you',
    `<div class="panel">
<h1>Thank you for your order</h1>
<p>Your payment was received. Your order number is <code>${escapeHtml(orderId)}</code>.</p>
<p>Your package is on its way.${trackingNumber ? ` Tracking number <code>${escapeHtml(trackingNumber)}</code>. <a href="/track/${escapeHtml(encodeURIComponent(trackingNumber))}">Track your parcel</a>.` : ''}</p>
<p><a href="/store">Back to the store</a></p>
</div>`,
  );
}

export function cancelPage(): string {
  return layout(
    'Payment canceled',
    `<div class="panel">
<h1>Payment canceled</h1>
<p>Payment canceled. Nothing was charged.</p>
<p><a href="/store">Back to the store</a></p>
</div>`,
  );
}

export function errorPage(title: string, message: string): string {
  return layout(
    title,
    `<div class="panel">
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
<p><a href="/store">Back to the store</a></p>
</div>`,
  );
}

const EVENT_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});
const eventTime = (v: string) => (Number.isNaN(new Date(v).getTime()) ? v : EVENT_TIME.format(new Date(v)));

export function trackLookupPage(message?: string): string {
  return layout(
    'Track a parcel',
    `<div class="panel">
<h1>Track a parcel</h1>
<p>Enter the tracking number from your order confirmation.</p>
${message ? `<p role="alert"><strong>${escapeHtml(message)}</strong></p>` : ''}
<form class="lookup" method="get" action="/track">
  <label class="field" style="flex:1;margin:0"><span class="eyebrow">Tracking number</span>
  <input type="text" name="number" autocomplete="off" inputmode="numeric" required></label>
  <button class="btn" type="submit" style="align-self:flex-end">Track</button>
</form>
<p class="sim-note">This is the sandbox carrier built for the Dispute Copilot demo. Parcels are simulated.</p>
</div>`,
  );
}

export function trackingPage(view: TrackingView): string {
  const events = [...view.events].reverse();
  const items = events
    .map(
      (e, i) => `<li${i === 0 ? ' class="is-latest"' : ''}>
  <span class="when">${escapeHtml(eventTime(e.occurredAt))}</span>
  <strong>${escapeHtml(e.description)}</strong>
  ${e.location ? `<span class="where">${escapeHtml(e.location)}</span>` : ''}
</li>`,
    )
    .join('\n');
  const badge =
    view.status === 'delivered' ? 'badge badge--ok' : view.status === 'delivery_failed' ? 'badge badge--bad' : 'badge';
  let proof = '';
  if (view.status === 'delivered') {
    proof = `<section class="proof" aria-labelledby="proof-title">
<h2 id="proof-title">Proof of delivery</h2>
<dl>
  <dt>Delivered</dt><dd>${escapeHtml(view.deliveredAt ? eventTime(view.deliveredAt) : 'Yes')}</dd>
  ${view.signedBy ? `<dt>Signed for by</dt><dd>${escapeHtml(view.signedBy)}</dd>` : ''}
  ${view.deliveredTo ? `<dt>Location</dt><dd>${escapeHtml(view.deliveredTo)}</dd>` : ''}
</dl>
</section>`;
  } else if (view.status === 'delivery_failed') {
    proof = `<section class="proof proof--bad" aria-labelledby="proof-title">
<h2 id="proof-title">Delivery exception</h2>
<p>The carrier could not locate this package and has opened an investigation. It has not been delivered.</p>
</section>`;
  }
  const live = !isFinalStatus(view.status) && view.simulated;
  return layout(
    `Tracking ${view.trackingNumber}`,
    `<div class="track">
<p class="eyebrow">${escapeHtml(view.carrier)}</p>
<h1>Track your parcel</h1>
<div class="track__head">
  <span class="track__num">${escapeHtml(view.trackingNumber)}</span>
  <span class="${badge}">${escapeHtml(view.statusLabel)}</span>
</div>
${proof}
<h2 class="eyebrow" style="margin:0 0 var(--space-3)">Scan history</h2>
<ol class="events">
${items}
</ol>
${view.simulated ? `<p class="sim-note">Sandbox carrier. This tracking is simulated for the demo and runs on a fast clock, so a parcel is delivered in about a minute and a half.${live ? ' This page refreshes by itself.' : ''}</p>` : ''}
<p><a href="/track">Track another parcel</a></p>
</div>`,
    live ? '<meta http-equiv="refresh" content="8">' : '',
  );
}
