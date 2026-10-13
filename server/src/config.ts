import { z } from 'zod';

export interface Config {
  port: number;
  paypal: {
    clientId: string;
    clientSecret: string;
    baseUrl: string;
    webhookId: string | null;
  };
  debugToken: string | null;
}

// Empty strings count as unset, so a blank line in .env behaves like a missing key.
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);
const required = (name: string) =>
  z.preprocess(blankToUndefined, z.string({ error: `${name} is required` }).min(1));
const optional = z.preprocess(blankToUndefined, z.string().optional());

const EnvSchema = z.object({
  PORT: z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(3000)),
  PAYPAL_CLIENT_ID: required('PAYPAL_CLIENT_ID'),
  PAYPAL_CLIENT_SECRET: required('PAYPAL_CLIENT_SECRET'),
  PAYPAL_BASE_URL: z.preprocess(
    blankToUndefined,
    z.string().url().default('https://api-m.sandbox.paypal.com'),
  ),
  PAYPAL_WEBHOOK_ID: optional,
  DEBUG_TOKEN: optional,
});

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'env'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    paypal: {
      clientId: e.PAYPAL_CLIENT_ID,
      clientSecret: e.PAYPAL_CLIENT_SECRET,
      baseUrl: e.PAYPAL_BASE_URL,
      webhookId: e.PAYPAL_WEBHOOK_ID ?? null,
    },
    debugToken: e.DEBUG_TOKEN ?? null,
  };
}
