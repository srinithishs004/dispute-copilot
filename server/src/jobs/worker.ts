import type { Db } from '../db/db.js';
import { claimNext, completeJob, failJob, failJobPermanently, type Job } from './queue.js';

export type JobHandler = (job: Job) => Promise<void>;

export interface WorkerDeps {
  db: Db;
  handlers: Record<string, JobHandler>;
  now: () => Date;
  logger: Pick<Console, 'info' | 'warn' | 'error'>;
}

/** Claims and runs one job. Returns false when nothing is due. Never logs payloads. */
export async function runWorkerOnce(deps: WorkerDeps): Promise<boolean> {
  const { db, handlers, now, logger } = deps;
  const job = await claimNext(db, now());
  if (!job) return false;

  const handler = Object.hasOwn(handlers, job.type) ? handlers[job.type] : undefined;
  if (!handler) {
    await failJobPermanently(db, job, `UnknownJobType: ${job.type}`, now());
    logger.warn(`job ${job.id} (${job.type}) failed: unknown job type`);
    return true;
  }

  try {
    await handler(job);
    await completeJob(db, job.id);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const outcome = await failJob(db, job, err, now());
    if (outcome === 'failed') {
      logger.warn(`job ${job.id} (${job.type}) failed permanently after attempt ${job.attempts}: ${err.name}`);
    }
  }
  return true;
}

export async function startWorker(
  deps: WorkerDeps & { sleep: (ms: number) => Promise<void>; idleMs?: number; signal: AbortSignal },
): Promise<void> {
  const { sleep, signal, idleMs = 1000 } = deps;
  while (!signal.aborted) {
    try {
      if (await runWorkerOnce(deps)) continue;
    } catch (e) {
      deps.logger.error(`worker loop error: ${e instanceof Error ? e.name : 'unknown'}`);
    }
    await sleep(idleMs);
  }
}
