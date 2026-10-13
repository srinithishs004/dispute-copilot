import { bootstrap, run } from './_bootstrap.js';
import { getDispute, listDisputes } from '../src/paypal/disputes.js';

await run(async () => {
  const c = bootstrap();
  const items = await listDisputes(c, { pageSize: 10 });
  if (items.length === 0) {
    console.log('No disputes yet.');
    return;
  }
  const newest = [...items].sort((a, b) => b.create_time.localeCompare(a.create_time));
  console.table(
    newest.slice(0, 10).map((d) => ({
      dispute_id: d.dispute_id,
      reason: d.reason,
      status: d.status,
      amount: d.dispute_amount ? `${d.dispute_amount.value} ${d.dispute_amount.currency_code}` : '',
      create_time: d.create_time,
    })),
  );
  const detail = await getDispute(c, newest[0]!.dispute_id);
  console.log(JSON.stringify(detail, null, 2));
});
