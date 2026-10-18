import type { Llm } from '../ai/llm.js';
import type { Db } from '../db/db.js';
import type { PayPalClient } from '../paypal/client.js';
import { analyzeDisputeJob } from './analyzeDispute.js';
import { processDispute } from './processDispute.js';
import type { JobHandler } from './worker.js';

export interface HandlerDeps {
  db: Db;
  paypal: PayPalClient;
  llm: Llm;
  now: () => Date;
  storeName: string;
}

export function buildHandlers(deps: HandlerDeps): Record<string, JobHandler> {
  const analyze = analyzeDisputeJob({ db: deps.db, llm: deps.llm, storeName: deps.storeName });
  return {
    processDispute: processDispute({ db: deps.db, paypal: deps.paypal, now: deps.now }),
    analyzeDispute: analyze,
    // Alias for jobs queued before this type was renamed.
    draftLetter: analyze,
  };
}
