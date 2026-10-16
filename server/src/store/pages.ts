import { PRODUCTS } from './repo.js';

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; background: #f5f7fa; color: #1a2433; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 16px; }
  h1 { font-size: 1.8rem; margin: 0 0 4px; }
  .sub { color: #5b6878; margin: 0 0 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; }
  .card { background: #fff; border: 1px solid #dde3ea; border-radius: 10px; padding: 20px; }
  .card h2 { font-size: 1.1rem; margin: 0 0 8px; }
  .price { font-size: 1.4rem; font-weight: 600; margin: 0 0 16px; }
  button { background: #ffc439; border: 0; border-radius: 6px; padding: 10px 16px; font-size: 1rem; font-weight: 600; cursor: pointer; width: 100%; }
  button:hover { background: #f2b82a; }
  .panel { background: #fff; border: 1px solid #dde3ea; border-radius: 10px; padding: 24px; }
  a { color: #0b5cad; }
  code { background: #eef1f5; padding: 2px 6px; border-radius: 4px; }
`;

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body}
</main>
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
    <button type="submit">Buy with PayPal</button>
  </form>
</div>`,
  ).join('\n');
  return layout(
    'Dispute Copilot Demo Store',
    `<h1>Dispute Copilot Demo Store</h1>
<p class="sub">A sandbox shop. Payments use PayPal sandbox accounts only; no real money moves.</p>
<div class="grid">
${cards}
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
    'Payment cancelled',
    `<div class="panel">
<h1>Payment cancelled</h1>
<p>Payment cancelled — nothing was charged.</p>
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
