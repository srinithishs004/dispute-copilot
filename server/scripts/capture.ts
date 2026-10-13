import { bootstrap, run, usageAndExit } from './_bootstrap.js';
import { captureOrder } from '../src/paypal/orders.js';

const orderId = process.argv[2];
if (!orderId) usageAndExit('npm run spike:capture -w server -- <orderId>');

await run(async () => {
  const c = bootstrap();
  const { status, captureId } = await captureOrder(c, orderId);
  console.log(`status:     ${status}`);
  console.log(`capture_id: ${captureId}`);
});
