import type { Db } from '../db/db.js';

export interface OrderRow {
  id: string;
  item: string | null;
  amount: string | null;
  currency: string | null;
  buyerEmail: string | null;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  status: string;
  createdAt: string | null;
}

export interface ShipmentRow {
  id: number;
  orderId: string;
  carrier: string | null;
  trackingNumber: string | null;
  status: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  signatureProof: boolean;
}

export interface MessageRow {
  id: number;
  orderId: string;
  sender: 'buyer' | 'seller';
  body: string | null;
  sentAt: string;
}

export interface PolicyRow {
  refundWindowDays: number;
  policyText: string;
}

export type OrderBundle = {
  order: OrderRow;
  shipments: ShipmentRow[];
  messages: MessageRow[];
  policy: PolicyRow;
};

export const PRODUCTS: { id: string; name: string; price: string }[] = [
  { id: 'mug', name: 'Ceramic Mug', price: '18.00' },
  { id: 'tee', name: 'Logo T-Shirt', price: '25.00' },
  { id: 'lamp', name: 'Desk Lamp', price: '49.00' },
];

type Ts = Date | string | null;
const iso = (v: Ts): string | null => (v == null ? null : new Date(v).toISOString());

interface OrderDb {
  id: string;
  item: string | null;
  amount: string | null;
  currency: string | null;
  buyer_email: string | null;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  status: string;
  created_at: Ts;
}

const ORDER_COLS =
  'id, item, amount::text as amount, currency, buyer_email, paypal_order_id, paypal_capture_id, status, created_at';

function toOrder(r: OrderDb): OrderRow {
  return {
    id: r.id,
    item: r.item,
    amount: r.amount,
    currency: r.currency,
    buyerEmail: r.buyer_email,
    paypalOrderId: r.paypal_order_id,
    paypalCaptureId: r.paypal_capture_id,
    status: r.status,
    createdAt: iso(r.created_at),
  };
}

export async function findOrderByCaptureId(db: Db, captureId: string): Promise<OrderRow | null> {
  const { rows } = await db.query<OrderDb>(`select ${ORDER_COLS} from orders where paypal_capture_id = $1`, [
    captureId,
  ]);
  return rows[0] ? toOrder(rows[0]) : null;
}

export async function findOrderBundle(db: Db, orderId: string): Promise<OrderBundle | null> {
  const { rows } = await db.query<OrderDb>(`select ${ORDER_COLS} from orders where id = $1`, [orderId]);
  if (!rows[0]) return null;

  const ships = await db.query<{
    id: number;
    order_id: string;
    carrier: string | null;
    tracking_number: string | null;
    status: string | null;
    shipped_at: Ts;
    delivered_at: Ts;
    signature_proof: boolean | null;
  }>(
    `select id, order_id, carrier, tracking_number, status, shipped_at, delivered_at, signature_proof
       from shipments where order_id = $1 order by shipped_at, id`,
    [orderId],
  );
  const msgs = await db.query<{
    id: number;
    order_id: string;
    sender: 'buyer' | 'seller';
    body: string | null;
    sent_at: Ts;
  }>(`select id, order_id, sender, body, sent_at from messages where order_id = $1 order by sent_at, id`, [
    orderId,
  ]);
  const pol = await db.query<{ refund_window_days: number; policy_text: string }>(
    `select refund_window_days, policy_text from store_policy where id = 1`,
  );
  const p = pol.rows[0];

  return {
    order: toOrder(rows[0]),
    shipments: ships.rows.map((s) => ({
      id: s.id,
      orderId: s.order_id,
      carrier: s.carrier,
      trackingNumber: s.tracking_number,
      status: s.status,
      shippedAt: iso(s.shipped_at),
      deliveredAt: iso(s.delivered_at),
      signatureProof: s.signature_proof ?? false,
    })),
    messages: msgs.rows.map((m) => ({
      id: m.id,
      orderId: m.order_id,
      sender: m.sender,
      body: m.body,
      sentAt: iso(m.sent_at)!,
    })),
    policy: { refundWindowDays: p?.refund_window_days ?? 0, policyText: p?.policy_text ?? '' },
  };
}
