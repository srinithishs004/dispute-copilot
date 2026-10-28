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
  :where(a, button, input):focus-visible { outline: none; box-shadow: var(--focus); border-radius: var(--radius-md); }
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
    h1 { font-size: 26px; line-height: 32px; }
    main { padding-top: var(--space-6); }
  }
  @media (prefers-reduced-motion: reduce) { .btn { transition: none; } }
`;

// Same families as web/src/styles/kaala/kaala.css, so the store matches the web app.
const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Manrope:wght@400..800&family=JetBrains+Mono:wght@400;500;600&family=Schibsted+Grotesk:wght@400..900&display=swap';

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<script src="/theme-init.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${escapeHtml(FONTS_URL)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body>
<header class="topbar">
  <div class="topbar__in">
    <a class="wordmark" href="/">Dispute Copilot</a>
    <span class="eyebrow">Demo store</span>
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
  <p><a href="/guide">Open the guide</a></p>
</div>`,
  );
}

export function thankYouPage(orderId: string): string {
  return layout(
    'Thank you',
    `<div class="panel">
<h1>Thank you for your order</h1>
<p>Your payment was received. Your order number is <code>${escapeHtml(orderId)}</code>.</p>
<p>Your package is on its way.</p>
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
