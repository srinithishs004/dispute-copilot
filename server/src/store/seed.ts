import type { Db } from '../db/db.js';

/** All seed timestamps are fixed offsets from this base so data is repeatable. */
const BASE = Date.parse('2026-09-15T10:00:00Z');
const DAY = 86_400_000;
const at = (days: number, hours = 0): string => new Date(BASE + days * DAY + hours * 3_600_000).toISOString();

interface SeedShipment {
  carrier: string;
  tracking: string;
  status: 'delivered' | 'in_transit';
  shipped: string;
  delivered: string | null;
  signed: boolean;
}
interface SeedMessage {
  sender: 'buyer' | 'seller';
  body: string;
  sentAt: string;
}
interface SeedOrder {
  id: string;
  item: string;
  amount: string;
  buyer: string;
  created: string;
  shipments: SeedShipment[];
  messages: SeedMessage[];
}

const delivered = (
  carrier: string,
  tracking: string,
  shippedDay: number,
  deliveredDay: number,
  signed: boolean,
): SeedShipment => ({
  carrier,
  tracking,
  status: 'delivered',
  shipped: at(shippedDay),
  delivered: at(deliveredDay, 4),
  signed,
});
const inTransit = (carrier: string, tracking: string, shippedDay: number): SeedShipment => ({
  carrier,
  tracking,
  status: 'in_transit',
  shipped: at(shippedDay),
  delivered: null,
  signed: false,
});

export const SEED_ORDERS: SeedOrder[] = [
  {
    id: 'DEMO-HIST-01',
    item: 'Ceramic Mug',
    amount: '18.00',
    buyer: 'alex.rivera@example.com',
    created: at(-60),
    shipments: [delivered('USPS', '9400111899223344556601', -59, -55, false)],
    messages: [],
  },
  {
    id: 'DEMO-HIST-02',
    item: 'Desk Lamp',
    amount: '49.00',
    buyer: 'jordan.lee@example.com',
    created: at(-58),
    shipments: [delivered('UPS', '1Z999AA10123456784', -57, -53, true)],
    messages: [],
  },
  {
    id: 'DEMO-HIST-03',
    item: 'Logo T-Shirt',
    amount: '25.00',
    buyer: 'sam.patel@example.com',
    created: at(-56),
    shipments: [delivered('FedEx', '794644790132', -55, -51, false)],
    messages: [],
  },
  {
    id: 'DEMO-HIST-04',
    item: 'Leather Wallet',
    amount: '84.50',
    buyer: 'casey.morgan@example.com',
    created: at(-54),
    shipments: [delivered('FedEx', '794644790245', -53, -49, true)],
    messages: [],
  },
  {
    id: 'DEMO-HIST-05',
    item: 'Wool Throw Blanket',
    amount: '72.00',
    buyer: 'taylor.nguyen@example.com',
    created: at(-12),
    shipments: [inTransit('USPS', '9400111899223344556605', -10)],
    messages: [],
  },
  {
    id: 'DEMO-HIST-06',
    item: 'Ceramic Mug',
    amount: '18.00',
    buyer: 'riley.chen@example.com',
    created: at(-14),
    shipments: [inTransit('UPS', '1Z999AA10123456790', -12)],
    messages: [],
  },
  {
    id: 'DEMO-HIST-07',
    item: 'Desk Lamp',
    amount: '49.00',
    buyer: 'morgan.silva@example.com',
    created: at(-20),
    shipments: [],
    messages: [],
  },
  {
    id: 'DEMO-HIST-08',
    item: 'Linen Tote Bag',
    amount: '34.00',
    buyer: 'drew.kim@example.com',
    created: at(-40),
    shipments: [delivered('USPS', '9400111899223344556608', -39, -35, false)],
    messages: [
      {
        sender: 'buyer',
        body: 'The tote looks nothing like the photos. The fabric is thin and the colour is faded.',
        sentAt: at(-33),
      },
      {
        sender: 'seller',
        body: 'Sorry to hear that! Could you send a photo of the bag so we can look into it?',
        sentAt: at(-32),
      },
    ],
  },
  {
    id: 'DEMO-HIST-09',
    item: 'Logo T-Shirt',
    amount: '25.00',
    buyer: 'avery.jones@example.com',
    created: at(-38),
    shipments: [delivered('UPS', '1Z999AA10123456801', -37, -33, false)],
    messages: [
      {
        sender: 'buyer',
        body: 'The shirt is a different print than the listing showed. This is not as described.',
        sentAt: at(-30),
      },
      {
        sender: 'seller',
        body: 'We are sorry about that. Please send us a photo of the shirt and we will make it right.',
        sentAt: at(-29),
      },
    ],
  },
  {
    id: 'DEMO-HIST-10',
    item: 'Ceramic Mug Set',
    amount: '36.00',
    buyer: 'quinn.harris@example.com',
    created: at(-100),
    shipments: [delivered('FedEx', '794644790378', -99, -95, false)],
    messages: [
      // exactly 45 days after delivery (delivered at -95d + 4h), outside the 30-day refund window
      { sender: 'buyer', body: 'I would like to return this and get a refund.', sentAt: at(-50, 4) },
    ],
  },
  {
    id: 'DEMO-HIST-11',
    item: 'Desk Lamp',
    amount: '49.00',
    buyer: 'blake.torres@example.com',
    created: at(-45),
    shipments: [delivered('USPS', '9400111899223344556611', -44, -40, false)],
    messages: [{ sender: 'buyer', body: 'Hi, it arrived, thanks! Looks great.', sentAt: at(-39) }],
  },
  {
    id: 'DEMO-HIST-12',
    item: 'Noise-Cancelling Headphones',
    amount: '119.00',
    buyer: 'jamie.ortiz@example.com',
    created: at(-30),
    shipments: [delivered('UPS', '1Z999AA10123456812', -29, -25, true)],
    messages: [
      {
        sender: 'buyer',
        body: 'This is unacceptable! I never ordered this and nobody can tell me where my money went. Refund me NOW.',
        sentAt: at(-20),
      },
    ],
  },
];

/** Idempotent: re-running inserts nothing new (children only for newly inserted orders). */
export async function seedStore(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into store_policy (id, refund_window_days, policy_text) values (1, $1, $2) on conflict (id) do nothing`,
      [30, 'Returns accepted within 30 days of delivery. Item must be unused.'],
    );
    for (const o of SEED_ORDERS) {
      const ins = await tx.query<{ id: string }>(
        `insert into orders (id, item, amount, currency, buyer_email, status, created_at)
         values ($1, $2, $3, 'USD', $4, 'COMPLETED', $5)
         on conflict (id) do nothing returning id`,
        [o.id, o.item, o.amount, o.buyer, o.created],
      );
      if (ins.rows.length === 0) continue;
      for (const s of o.shipments) {
        await tx.query(
          `insert into shipments (order_id, carrier, tracking_number, status, shipped_at, delivered_at, signature_proof)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [o.id, s.carrier, s.tracking, s.status, s.shipped, s.delivered, s.signed],
        );
      }
      for (const m of o.messages) {
        await tx.query(`insert into messages (order_id, sender, body, sent_at) values ($1, $2, $3, $4)`, [
          o.id,
          m.sender,
          m.body,
          m.sentAt,
        ]);
      }
    }
  });
}
