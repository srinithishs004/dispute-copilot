import { bootstrap, parseAmount, run, usageAndExit } from './_bootstrap.js';
import { createOrder } from '../src/paypal/orders.js';

const amount = parseAmount(process.argv[2]);
if (!amount) usageAndExit('npm run spike:order -w server -- <amount>   (e.g. 25.00)');

await run(async () => {
  const c = bootstrap();
  const { id, approveUrl } = await createOrder(c, {
    invoiceId: `DEMO-${Date.now()}`,
    amount,
    currency: 'USD',
    description: 'Dispute Copilot sandbox demo order',
  });
  console.log(`order_id:    ${id}`);
  console.log(`approve_url: ${approveUrl}`);
});
