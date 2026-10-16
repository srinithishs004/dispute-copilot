import { createHash, randomBytes } from 'node:crypto';
import { Router, type Response } from 'express';
import type { AppDeps } from '../app.js';
import { captureOrder, createOrder } from '../paypal/orders.js';
import { cancelPage, errorPage, storePage, thankYouPage } from '../store/pages.js';
import { PRODUCTS } from '../store/repo.js';

const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** ORD- plus 8 uppercase base36 characters from a CSPRNG (modulo bias is irrelevant for a demo id). */
function newOrderId(): string {
  const bytes = randomBytes(8);
  return 'ORD-' + Array.from(bytes, (b) => BASE36[b % 36]).join('');
}

/** USPS-style tracking number: "9400" + 18 digits, each the first 18 hex digits of sha256(orderId) taken mod 10. */
function trackingNumberFor(orderId: string): string {
  const hex = createHash('sha256').update(orderId).digest('hex');
  return '9400' + Array.from(hex.slice(0, 18), (c) => String(parseInt(c, 16) % 10)).join('');
}

function html(res: Response, status: number, page: string): void {
  res.status(status).type('text/html; charset=utf-8').send(page);
}

export function storeRoutes(deps: AppDeps): Router {
  const { db, paypal, config } = deps;
  const logger = deps.logger ?? console;
  const router = Router();

  router.get('/store', (_req, res) => {
    html(res, 200, storePage());
  });

  router.post('/store/checkout', async (req, res) => {
    const productId = typeof req.body?.productId === 'string' ? req.body.productId : '';
    const product = PRODUCTS.find((p) => p.id === productId);
    if (!product) {
      html(res, 400, errorPage('Unknown product', 'That product does not exist.'));
      return;
    }
    const orderId = newOrderId();
    try {
      await db.query(
        `insert into orders (id, item, amount, currency, buyer_email, status)
         values ($1, $2, $3, 'USD', null, 'PENDING')`,
        [orderId, product.name, product.price],
      );
      const created = await createOrder(paypal, {
        invoiceId: orderId,
        amount: product.price,
        currency: 'USD',
        description: product.name,
        returnUrl: `${config.publicBaseUrl}/store/return`,
        cancelUrl: `${config.publicBaseUrl}/store/cancel`,
        requestId: `create-${orderId}`,
      });
      await db.query('update orders set paypal_order_id = $1 where id = $2', [created.id, orderId]);
      res.redirect(303, created.approveUrl);
    } catch (err) {
      logger.warn(`checkout failed: ${err instanceof Error ? err.name : 'unknown'}`);
      html(res, 502, errorPage('Checkout unavailable', 'We could not start the PayPal checkout. Please try again.'));
    }
  });

  router.get('/store/return', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const found = token
      ? (await db.query<{ id: string; status: string }>(
          'select id, status from orders where paypal_order_id = $1',
          [token],
        )).rows[0]
      : undefined;
    if (!found) {
      html(res, 400, errorPage('Order not found', 'We could not find that order.'));
      return;
    }
    if (found.status === 'PAID') {
      html(res, 200, thankYouPage(found.id));
      return;
    }
    try {
      const { captureId } = await captureOrder(paypal, token, { requestId: `capture-${found.id}` });
      await db.transaction(async (tx) => {
        // Only the request that flips PENDING to PAID creates the shipment.
        const updated = await tx.query(
          `update orders set paypal_capture_id = $1, status = 'PAID'
           where id = $2 and status <> 'PAID' returning id`,
          [captureId, found.id],
        );
        if (updated.rows.length === 0) return;
        await tx.query(
          `insert into shipments (order_id, carrier, tracking_number, status, shipped_at)
           values ($1, 'USPS', $2, 'in_transit', now())`,
          [found.id, trackingNumberFor(found.id)],
        );
      });
      html(res, 200, thankYouPage(found.id));
    } catch (err) {
      logger.warn(`capture failed: ${err instanceof Error ? err.name : 'unknown'}`);
      html(res, 502, errorPage('Payment not completed', 'We could not confirm your payment. Please try again.'));
    }
  });

  router.get('/store/cancel', (_req, res) => {
    html(res, 200, cancelPage());
  });

  return router;
}
