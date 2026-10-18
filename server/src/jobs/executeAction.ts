import type { Db } from '../db/db.js';
import { getAction, markFailed, markSent, type ActionRow } from '../actions/repo.js';
import { setLocalStateIf } from '../disputes/repo.js';
import { maskId } from '../log.js';
import { PayPalError, type PayPalClient } from '../paypal/client.js';
import { acceptClaim, makeOffer, provideEvidence } from '../paypal/disputes.js';
import { enqueue, MAX_ATTEMPTS } from './queue.js';
import type { JobHandler } from './worker.js';

const MAX_ERROR_LENGTH = 500;

export interface ExecuteActionDeps {
  db: Db;
  paypal: PayPalClient;
  now: () => Date;
  logger?: Pick<Console, 'info' | 'warn'>;
}

function call(paypal: PayPalClient, action: ActionRow): Promise<unknown> {
  const requestId = `dc-action-${action.id}`;
  const { note, offerAmount, currency, tracking } = action.payload;
  switch (action.type) {
    case 'FIGHT':
      return provideEvidence(paypal, action.disputeId, { notes: note, ...(tracking ? { tracking } : {}) }, requestId);
    case 'OFFER':
      if (offerAmount === undefined) throw new Error('executeAction: OFFER without offerAmount');
      return makeOffer(
        paypal,
        action.disputeId,
        { note, amount: { currency_code: currency, value: offerAmount } },
        requestId,
      );
    case 'ACCEPT':
      return acceptClaim(paypal, action.disputeId, { note }, requestId);
  }
}

/** A definitive PayPal refusal: retrying the same request cannot succeed. */
function isRejection(err: unknown): err is PayPalError {
  return err instanceof PayPalError && err.status >= 400 && err.status < 500 && err.status !== 429;
}

/** Sends one approved action to PayPal. Never logs the note or PayPal bodies. */
export function executeActionJob(deps: ExecuteActionDeps): JobHandler {
  const { db, paypal, now } = deps;
  const logger = deps.logger ?? console;
  return async (job) => {
    const actionId = (job.payload as { actionId?: unknown } | null)?.actionId;
    if (typeof actionId !== 'number' || !Number.isInteger(actionId)) {
      throw new Error('executeAction: payload.actionId missing');
    }
    const action = await getAction(db, actionId);
    if (!action || action.state !== 'PENDING') {
      logger.info(`executeAction job ${job.id} action=${actionId}: skipped (not pending)`);
      return;
    }
    const tag = `executeAction job ${job.id} action=${actionId} dispute=${maskId(action.disputeId)}`;

    const fail = async (error: string, reason: string) => {
      await db.transaction(async (tx) => {
        if (await markFailed(tx, actionId, error.slice(0, MAX_ERROR_LENGTH))) {
          await setLocalStateIf(tx, action.disputeId, 'ACTION_PENDING', 'NEEDS_MANUAL', reason);
        }
      });
    };

    let response: unknown;
    try {
      response = await call(paypal, action);
    } catch (err) {
      if (isRejection(err)) {
        await fail(`${err.name}: ${err.message}`, `PayPal rejected the action (${err.name})`);
        logger.warn(`${tag}: rejected by PayPal (${err.name})`);
        return;
      }
      if (job.attempts >= MAX_ATTEMPTS) {
        await fail(err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error', 'Could not reach PayPal');
        logger.warn(`${tag}: gave up after attempt ${job.attempts}`);
      } else {
        logger.warn(`${tag}: will retry after attempt ${job.attempts}`);
      }
      throw err;
    }

    await db.transaction(async (tx) => {
      if (!(await markSent(tx, actionId, response, now()))) return;
      await setLocalStateIf(tx, action.disputeId, 'ACTION_PENDING', 'ACTION_SENT');
      await enqueue(tx, 'processDispute', { disputeId: action.disputeId });
    });
    logger.info(`${tag}: sent`);
  };
}
