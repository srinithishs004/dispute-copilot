import type { Db } from '../db/db.js';
import type { DisputeAction } from '../paypal/disputes.js';

export type ActionPayload = {
  note: string;
  offerAmount?: string;
  currency: string;
  tracking?: { carrier: string; number: string }[];
};

export type ActionRow = {
  id: number;
  disputeId: string;
  type: DisputeAction;
  payload: ActionPayload;
  state: 'PENDING' | 'SENT' | 'FAILED';
  error: string | null;
  createdAt: string;
  sentAt: string | null;
};

export class ActionConflictError extends Error {
  override name = 'ActionConflictError';
  constructor() {
    super('an action is already pending for this dispute');
  }
}

type Row = {
  id: number | string;
  dispute_id: string;
  type: DisputeAction;
  payload: ActionPayload;
  state: ActionRow['state'];
  error: string | null;
  created_at: Date | string;
  sent_at: Date | string | null;
};

const COLS = 'id, dispute_id, type, payload, state, error, created_at, sent_at';

function toRow(r: Row): ActionRow {
  return {
    id: Number(r.id),
    disputeId: r.dispute_id,
    type: r.type,
    payload: r.payload,
    state: r.state,
    error: r.error,
    createdAt: new Date(r.created_at).toISOString(),
    sentAt: r.sent_at == null ? null : new Date(r.sent_at).toISOString(),
  };
}

/** Inserts a PENDING action. The partial unique index allows one open action per dispute; a violation (23505) becomes ActionConflictError. */
export async function createPendingAction(
  tx: Db,
  disputeId: string,
  type: DisputeAction,
  payload: ActionPayload,
  now: Date,
): Promise<number> {
  try {
    const res = await tx.query<{ id: number | string }>(
      `insert into actions (dispute_id, type, payload, state, approved_at, created_at)
       values ($1, $2, $3::jsonb, 'PENDING', $4, $4) returning id`,
      [disputeId, type, JSON.stringify(payload), now.toISOString()],
    );
    return Number(res.rows[0]!.id);
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === '23505') throw new ActionConflictError();
    throw err;
  }
}

/** Marks a PENDING action SENT. Returns false when it was no longer PENDING (nothing changed). */
export async function markSent(db: Db, id: number, response: unknown, now: Date): Promise<boolean> {
  const res = await db.query(
    `update actions set state = 'SENT', paypal_response = $2::jsonb, error = null, sent_at = $3
     where id = $1 and state = 'PENDING' returning 1`,
    [id, JSON.stringify(response ?? null), now.toISOString()],
  );
  return res.rows.length > 0;
}

/** Marks a PENDING action FAILED. Returns false when it was no longer PENDING (nothing changed). */
export async function markFailed(db: Db, id: number, error: string): Promise<boolean> {
  const res = await db.query(
    `update actions set state = 'FAILED', error = $2 where id = $1 and state = 'PENDING' returning 1`,
    [id, error],
  );
  return res.rows.length > 0;
}

export async function getAction(db: Db, id: number): Promise<ActionRow | null> {
  const { rows } = await db.query<Row>(`select ${COLS} from actions where id = $1`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

export async function listActions(db: Db, disputeId: string): Promise<ActionRow[]> {
  const { rows } = await db.query<Row>(
    `select ${COLS} from actions where dispute_id = $1 order by created_at desc, id desc`,
    [disputeId],
  );
  return rows.map(toRow);
}
