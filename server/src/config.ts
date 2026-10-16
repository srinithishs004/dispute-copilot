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
  databaseUrl: string | null;
  pgliteDir: string;
  /** Run the job worker inside the web process (default: only when DATABASE_URL is unset). */
  runWorkerInline: boolean;
  /** Public origin of this server; PayPal sends buyers back to it. */
  publicBaseUrl: string;
  llm: {
    gemini: { apiKey: string | null; model: string };
    groq: { apiKey: string | null; model: string };
  };
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
    z
      .string()
      .url()
      .default('https://api-m.sandbox.paypal.com')
      .refine((u) => new URL(u).hostname === 'api-m.sandbox.paypal.com', {
        message: 'PAYPAL_BASE_URL must be the PayPal sandbox URL (https://api-m.sandbox.paypal.com)',
      }),
  ),
  PAYPAL_WEBHOOK_ID: optional,
  DEBUG_TOKEN: optional,
  DATABASE_URL: optional,
  RUN_WORKER_INLINE: z.preprocess(blankToUndefined, z.enum(['true', 'false']).optional()),
  PGLITE_DIR: z.preprocess(blankToUndefined, z.string().default('.data/pglite')),
  PUBLIC_BASE_URL: z.preprocess(blankToUndefined, z.string().url().default('http://localhost:3000')),
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: z.preprocess(blankToUndefined, z.string().default('gemini-3.6-flash')),
  GROQ_API_KEY: optional,
  GROQ_MODEL: z.preprocess(blankToUndefined, z.string().default('llama-3.3-70b-versatile')),
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
    databaseUrl: e.DATABASE_URL ?? null,
    pgliteDir: e.PGLITE_DIR,
    runWorkerInline: e.RUN_WORKER_INLINE === undefined ? e.DATABASE_URL === undefined : e.RUN_WORKER_INLINE === 'true',
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    llm: {
      gemini: { apiKey: e.GEMINI_API_KEY ?? null, model: e.GEMINI_MODEL },
      groq: { apiKey: e.GROQ_API_KEY ?? null, model: e.GROQ_MODEL },
    },
  };
}
