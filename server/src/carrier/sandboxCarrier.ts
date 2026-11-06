import type { Db } from '../db/db.js';

/**
 * Sandbox carrier: a small tracking simulator for the demo store.
 *
 * PayPal's sandbox has no real parcels, so a dispute about a delivery has nothing to prove it.
 * This module plays the carrier. It follows the usual tracking model (label created, in transit,
 * out for delivery, delivered, or a delivery exception) and writes scan events that the
 * evidence pack, the Review page and the public /track page all read.
 *
 * Time is compressed: a parcel is delivered about 90 seconds after payment. Events are a pure
 * function of the shipped time and the scenario, so there is no timer or cron to keep alive:
 * the tracking is brought up to date whenever somebody reads it.
 */

export type SimScenario = 'DELIVERED' | 'LOST';

/** Shipment status values stored on `shipments.status` for simulated parcels. */
export type ShipmentStatus = 'pre_transit' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'delivery_failed';

export const SIM_SCENARIOS: SimScenario[] = ['DELIVERED', 'LOST'];
export const isSimScenario = (v: unknown): v is SimScenario => v === 'DELIVERED' || v === 'LOST';

export interface Step {
  /** Event key, unique per shipment. */
  status: 'label_created' | 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'delivery_exception';
  afterSec: number;
  description: string;
  location: string | null;
  shipment: ShipmentStatus;
}

const COMMON: Step[] = [
  { status: 'label_created', afterSec: 0, description: 'Shipping label created, waiting for pickup', location: null, shipment: 'pre_transit' },
  { status: 'picked_up', afterSec: 15, description: 'Picked up by the carrier', location: 'Seller location', shipment: 'in_transit' },
  { status: 'in_transit', afterSec: 35, description: 'Arrived at the regional sorting facility', location: 'Regional sorting facility', shipment: 'in_transit' },
];

const DELIVERED: Step[] = [
  ...COMMON,
  { status: 'out_for_delivery', afterSec: 60, description: 'Out for delivery', location: 'Local delivery hub', shipment: 'out_for_delivery' },
  { status: 'delivered', afterSec: 90, description: 'Delivered. Signature obtained from the recipient', location: 'Delivery address', shipment: 'delivered' },
];

const LOST: Step[] = [
  ...COMMON,
  {
    status: 'delivery_exception',
    afterSec: 60,
    description: 'Delivery exception: the carrier cannot locate the package and has opened an investigation',
    location: 'Regional sorting facility',
    shipment: 'delivery_failed',
  },
];

export const SIGNED_BY = 'Recipient (electronic signature)';
export const DELIVERED_TO = 'Delivery address on the order';

export function stepsFor(scenario: SimScenario): Step[] {
  return scenario === 'LOST' ? LOST : DELIVERED;
}

export function occurredAt(shippedAt: Date, step: Step): Date {
  return new Date(shippedAt.getTime() + step.afterSec * 1000);
}

/** The steps that have already happened at `now`, in order. */
export function dueSteps(scenario: SimScenario, shippedAt: Date, now: Date): Step[] {
  return stepsFor(scenario).filter((s) => occurredAt(shippedAt, s).getTime() <= now.getTime());
}

export const STATUS_LABEL: Record<string, string> = {
  pre_transit: 'Label created',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  delivery_failed: 'Delivery exception',
};

export const isFinalStatus = (s: string | null) => s === 'delivered' || s === 'delivery_failed';

type Ts = Date | string | null;
const iso = (v: Ts): string | null => (v == null ? null : new Date(v).toISOString());

/**
 * Writes any scan events that are due and updates the shipment row (status, delivered_at, signature).
 * Safe to call at any time and from concurrent requests: events are unique per shipment and status.
 */
export async function syncOrderTracking(db: Db, orderId: string, now: Date): Promise<void> {
  const { rows } = await db.query<{ id: number; sim_scenario: string; shipped_at: Ts }>(
    `select id, sim_scenario, shipped_at from shipments where order_id = $1 and simulated`,
    [orderId],
  );
  for (const s of rows) {
    if (s.shipped_at == null) continue;
    const scenario: SimScenario = isSimScenario(s.sim_scenario) ? s.sim_scenario : 'DELIVERED';
    const shippedAt = new Date(s.shipped_at);
    const due = dueSteps(scenario, shippedAt, now);
    if (due.length === 0) continue;
    await db.transaction(async (tx) => {
      for (const step of due) {
        await tx.query(
          `insert into tracking_events (shipment_id, status, description, location, occurred_at)
           values ($1, $2, $3, $4, $5) on conflict (shipment_id, status) do nothing`,
          [s.id, step.status, step.description, step.location, occurredAt(shippedAt, step).toISOString()],
        );
      }
      const last = due[due.length - 1]!;
      if (last.shipment === 'delivered') {
        await tx.query(
          `update shipments set status = 'delivered', delivered_at = $2, signature_proof = true, signed_by = $3, delivered_to = $4
           where id = $1 and status is distinct from 'delivered'`,
          [s.id, occurredAt(shippedAt, last).toISOString(), SIGNED_BY, DELIVERED_TO],
        );
      } else {
        await tx.query(`update shipments set status = $2 where id = $1 and status is distinct from $2`, [s.id, last.shipment]);
      }
    });
  }
}

export interface TrackingEventView {
  status: string;
  description: string;
  location: string | null;
  occurredAt: string;
}

export interface TrackingView {
  trackingNumber: string;
  carrier: string;
  simulated: boolean;
  status: string;
  statusLabel: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  signedBy: string | null;
  deliveredTo: string | null;
  events: TrackingEventView[];
}

type ShipRow = {
  id: number;
  order_id: string | null;
  carrier: string | null;
  tracking_number: string | null;
  status: string | null;
  simulated: boolean;
  shipped_at: Ts;
  delivered_at: Ts;
  signed_by: string | null;
  delivered_to: string | null;
  signature_proof: boolean | null;
};

const SHIP_COLS =
  'id, order_id, carrier, tracking_number, status, simulated, shipped_at, delivered_at, signed_by, delivered_to, signature_proof';

async function toView(db: Db, r: ShipRow): Promise<TrackingView> {
  const ev = await db.query<{ status: string; description: string; location: string | null; occurred_at: Ts }>(
    `select status, description, location, occurred_at from tracking_events where shipment_id = $1 order by occurred_at, id`,
    [r.id],
  );
  let events: TrackingEventView[] = ev.rows.map((e) => ({
    status: e.status,
    description: e.description,
    location: e.location,
    occurredAt: iso(e.occurred_at)!,
  }));
  // Parcels from before the simulator (seed data) have no scan events: derive a short history.
  if (events.length === 0) {
    if (r.shipped_at) events.push({ status: 'in_transit', description: 'Shipped by the seller', location: null, occurredAt: iso(r.shipped_at)! });
    if (r.delivered_at) events.push({ status: 'delivered', description: 'Delivered', location: null, occurredAt: iso(r.delivered_at)! });
  }
  const status = r.status && STATUS_LABEL[r.status] ? r.status : r.status === 'delivered' ? 'delivered' : 'in_transit';
  return {
    trackingNumber: r.tracking_number ?? '',
    carrier: r.simulated ? 'Sandbox carrier' : (r.carrier ?? 'Carrier'),
    simulated: r.simulated,
    status,
    statusLabel: STATUS_LABEL[status] ?? 'In transit',
    shippedAt: iso(r.shipped_at),
    deliveredAt: iso(r.delivered_at),
    signedBy: r.signed_by,
    deliveredTo: r.delivered_to,
    events,
  };
}

/** Public lookup by tracking number. Never returns the order id or any buyer detail. */
export async function getTrackingView(db: Db, trackingNumber: string, now: Date): Promise<TrackingView | null> {
  const found = await db.query<ShipRow>(`select ${SHIP_COLS} from shipments where tracking_number = $1 order by id limit 1`, [
    trackingNumber,
  ]);
  const first = found.rows[0];
  if (!first) return null;
  if (first.simulated && first.order_id) await syncOrderTracking(db, first.order_id, now);
  const fresh = await db.query<ShipRow>(`select ${SHIP_COLS} from shipments where id = $1`, [first.id]);
  return toView(db, fresh.rows[0] ?? first);
}

/** All parcels of one order, brought up to date. Used by the Review page. */
export async function trackingViewsForOrder(db: Db, orderId: string, now: Date): Promise<TrackingView[]> {
  await syncOrderTracking(db, orderId, now);
  const { rows } = await db.query<ShipRow>(`select ${SHIP_COLS} from shipments where order_id = $1 order by shipped_at, id`, [orderId]);
  return Promise.all(rows.map((r) => toView(db, r)));
}
