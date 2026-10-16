import type { Llm } from '../ai/llm.js';
import type { Db } from '../db/db.js';
import type { PayPalClient } from '../paypal/client.js';
import { draftLetterJob } from './draftLetter.js';
import { processDispute } from './processDispute.js';
import type { JobHandler } from './worker.js';

export interface HandlerDeps {
  db: Db;
  paypal: PayPalClient;
  llm: Llm;
  now: () => Date;
}

export function buildHandlers(deps: HandlerDeps): Record<string, JobHandler> {
  return {
    processDispute: processDispute({ db: deps.db, paypal: deps.paypal, now: deps.now }),
    draftLetter: draftLetterJob({ db: deps.db, llm: deps.llm }),
  };
}
