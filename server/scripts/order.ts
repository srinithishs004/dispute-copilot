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
    // Placeholder pages: after "Pay Now" the browser lands on example.com — that means approval worked.
    returnUrl: 'https://example.com/paypal-approved',
    cancelUrl: 'https://example.com/paypal-cancelled',
  });
  console.log(`order_id:    ${id}`);
  console.log(`approve_url: ${approveUrl}`);
  console.log('Open the link, log in as the sandbox PERSONAL (buyer) account, click Pay Now.');
  console.log('When the browser lands on example.com, approval is done — then run spike:capture with the order_id.');
});
