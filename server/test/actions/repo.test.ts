import { describe, expect, it } from 'vitest';
import {
  ActionConflictError,
  createPendingAction,
  getAction,
  listActions,
  markFailed,
  markSent,
} from '../../src/actions/repo.js';
import { makeTestDb as baseDb } from '../helpers.js';

async function makeTestDb() {
  const db = await baseDb();
  await db.query("insert into disputes (paypal_dispute_id) values ('PP-D-1'), ('PP-D-2')");
  return db;
}

const payload = { note: 'n'.repeat(20), currency: 'USD' };

describe('actions repo', () => {
  it('creates a pending action and reads it back', async () => {
    const db = await makeTestDb();
    const now = new Date('2026-10-18T10:00:00Z');
    const id = await createPendingAction(db, 'PP-D-1', 'OFFER', { ...payload, offerAmount: '12.50' }, now);
    const a = await getAction(db, id);
    expect(a).toEqual({
      id,
      disputeId: 'PP-D-1',
      type: 'OFFER',
      payload: { ...payload, offerAmount: '12.50' },
      state: 'PENDING',
      error: null,
      createdAt: expect.any(String),
      sentAt: null,
    });
    const { rows } = await db.query<{ approved_at: Date }>('select approved_at from actions where id = $1', [id]);
    expect(rows[0]!.approved_at.toISOString()).toBe(now.toISOString());
  });

  it('getAction returns null for an unknown id', async () => {
    expect(await getAction(await makeTestDb(), 999)).toBeNull();
  });

  it('throws ActionConflictError for a second PENDING action on the same dispute', async () => {
    const db = await makeTestDb();
    await createPendingAction(db, 'PP-D-1', 'ACCEPT', payload, new Date());
    await expect(createPendingAction(db, 'PP-D-1', 'FIGHT', payload, new Date())).rejects.toBeInstanceOf(
      ActionConflictError,
    );
    // a different dispute is fine
    await createPendingAction(db, 'PP-D-2', 'FIGHT', payload, new Date());
  });

  it('allows a new action once the earlier one is no longer PENDING', async () => {
    const db = await makeTestDb();
    const id = await createPendingAction(db, 'PP-D-1', 'ACCEPT', payload, new Date());
    await markFailed(db, id, 'boom');
    await createPendingAction(db, 'PP-D-1', 'OFFER', payload, new Date());
    expect((await listActions(db, 'PP-D-1')).map((a) => a.state).sort()).toEqual(['FAILED', 'PENDING']);
  });

  it('markSent and markFailed update state', async () => {
    const db = await makeTestDb();
    const a = await createPendingAction(db, 'PP-D-1', 'ACCEPT', payload, new Date());
    await markSent(db, a, { ok: true }, new Date('2026-10-18T11:00:00Z'));
    expect(await getAction(db, a)).toMatchObject({ state: 'SENT', sentAt: '2026-10-18T11:00:00.000Z' });
    const b = await createPendingAction(db, 'PP-D-1', 'ACCEPT', payload, new Date());
    await markFailed(db, b, 'bad');
    expect(await getAction(db, b)).toMatchObject({ state: 'FAILED', error: 'bad' });
  });

  it('listActions returns newest first', async () => {
    const db = await makeTestDb();
    const a = await createPendingAction(db, 'PP-D-1', 'ACCEPT', payload, new Date());
    await markFailed(db, a, 'x');
    const b = await createPendingAction(db, 'PP-D-1', 'OFFER', payload, new Date());
    expect((await listActions(db, 'PP-D-1')).map((x) => x.id)).toEqual([b, a]);
  });
});
