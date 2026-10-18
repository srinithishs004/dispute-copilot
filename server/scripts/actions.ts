import { bootstrap, parseAmount, run, usageAndExit } from './_bootstrap.js';
import {
  acceptClaim,
  adjudicate,
  allowedActions,
  escalate,
  getDispute,
  makeOffer,
  provideEvidence,
  requireEvidence,
  sendMessage,
  type DisputeDetail,
  type Money,
} from '../src/paypal/disputes.js';

const USAGE =
  'npm run spike:action -- <disputeId> <show|message <text>|offer <amount>|evidence|accept [amount]|escalate|require-evidence|settle <SELLER_FAVOR|BUYER_FAVOR>>';

const [disputeId, command, arg] = process.argv.slice(2);
if (!disputeId || !command) usageAndExit(USAGE);

await run(async () => {
  const c = bootstrap();
  const requestId = `spike-${command}-${Date.now()}`;

  // Never prints response bodies (buyer data): only stage/status from a follow-up read.
  const summary = async (): Promise<void> => {
    const d = await getDispute(c, disputeId);
    console.log(`HTTP success. status=${d.status} stage=${d.dispute_life_cycle_stage ?? 'n/a'}`);
  };

  const currency = async (): Promise<string> => {
    const d: DisputeDetail = await getDispute(c, disputeId);
    return d.dispute_amount?.currency_code ?? 'USD';
  };
  const money = async (raw: string | undefined): Promise<Money> => {
    const value = parseAmount(raw);
    if (!value) usageAndExit(USAGE);
    return { currency_code: await currency(), value };
  };

  switch (command) {
    case 'show': {
      const d = await getDispute(c, disputeId);
      console.log(`status: ${d.status}`);
      console.log(`dispute_life_cycle_stage: ${d.dispute_life_cycle_stage ?? 'n/a'}`);
      console.log(`allowedActions: ${JSON.stringify(allowedActions(d))}`);
      console.log(`allowed_response_options: ${JSON.stringify(d.allowed_response_options ?? null)}`);
      return;
    }
    case 'message':
      if (!arg) usageAndExit(USAGE);
      await sendMessage(c, disputeId, arg, requestId);
      break;
    case 'offer':
      await makeOffer(c, disputeId, { note: 'Spike offer', amount: await money(arg) }, requestId);
      break;
    case 'evidence':
      await provideEvidence(
        c,
        disputeId,
        { notes: 'Spike evidence', tracking: [{ carrier: 'DHL', number: 'SPIKE123456' }] },
        requestId,
      );
      break;
    case 'accept':
      await acceptClaim(
        c,
        disputeId,
        arg ? { note: 'Spike accept', amount: await money(arg) } : { note: 'Spike accept' },
        requestId,
      );
      break;
    case 'escalate':
      await escalate(c, disputeId, 'Spike escalation', requestId);
      break;
    case 'require-evidence':
      await requireEvidence(c, disputeId, 'BUYER_EVIDENCE', requestId);
      break;
    case 'settle':
      if (arg !== 'SELLER_FAVOR' && arg !== 'BUYER_FAVOR') usageAndExit(USAGE);
      await adjudicate(c, disputeId, arg, requestId);
      break;
    default:
      usageAndExit(USAGE);
  }
  await summary();
});
