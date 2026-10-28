import { z } from 'zod';

export type Account = { email: string; passwordHash: string };

export interface Config {
  port: number;
  paypal: {
    clientId: string;
    clientSecret: string;
    baseUrl: string;
    webhookId: string | null;
  };
  debugToken: string | null;
  /** Seller-app logins. A missing account is disabled; no secret disables login entirely. */
  auth: { owner: Account | null; judge: Account | null; sessionSecret: string | null };
  databaseUrl: string | null;
  pgliteDir: string;
  /** Run the job worker inside the web process (default: only when DATABASE_URL is unset). */
  runWorkerInline: boolean;
  /** Public origin of this server; PayPal sends buyers back to it. */
  publicBaseUrl: string;
  /** Store name the AI signs buyer and PayPal letters with. */
  storeName: string;
  llm: {
    gemini: { apiKey: string | null; model: string };
    groq: { apiKey: string | null; model: string };
    /** Per-call timeout. 2 calls x 3 provider attempts must stay under the 5 min job lease. */
    timeoutMs: number;
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
  OWNER_EMAIL: optional,
  OWNER_PASSWORD_HASH: optional,
  JUDGE_EMAIL: optional,
  JUDGE_PASSWORD_HASH: optional,
  SESSION_SECRET: z.preprocess(
    blankToUndefined,
    z.string().min(32, { error: 'SESSION_SECRET must be at least 32 characters' }).optional(),
  ),
  DATABASE_URL: optional,
  RUN_WORKER_INLINE: z.preprocess(blankToUndefined, z.enum(['true', 'false']).optional()),
  PGLITE_DIR: z.preprocess(blankToUndefined, z.string().default('.data/pglite')),
  PUBLIC_BASE_URL: z.preprocess(blankToUndefined, z.string().url().default('http://localhost:3000')),
  STORE_NAME: z.preprocess(blankToUndefined, z.string().default('Dispute Copilot Demo Store')),
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: z.preprocess(blankToUndefined, z.string().default('gemini-3.6-flash')),
  GROQ_API_KEY: optional,
  // llama-3.3-70b-versatile was shut down by Groq on Aug 16, 2026.
  GROQ_MODEL: z.preprocess(blankToUndefined, z.string().default('openai/gpt-oss-120b')),
  LLM_TIMEOUT_MS: z.preprocess(blankToUndefined, z.coerce.number().int().min(5_000).max(90_000).default(45_000)),
}).superRefine((e, ctx) => {
  // An account needs both halves; name whichever is missing.
  for (const [email, hash] of [
    ['OWNER_EMAIL', 'OWNER_PASSWORD_HASH'],
    ['JUDGE_EMAIL', 'JUDGE_PASSWORD_HASH'],
  ] as const) {
    const hasEmail = e[email] !== undefined;
    const hasHash = e[hash] !== undefined;
    if (hasEmail && !hasHash) ctx.addIssue({ code: 'custom', path: [hash], message: `${hash} is required when ${email} is set` });
    if (hasHash && !hasEmail) ctx.addIssue({ code: 'custom', path: [email], message: `${email} is required when ${hash} is set` });
  }
});

const account = (email: string | undefined, passwordHash: string | undefined): Account | null =>
  email !== undefined && passwordHash !== undefined ? { email, passwordHash } : null;

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
    auth: {
      owner: account(e.OWNER_EMAIL, e.OWNER_PASSWORD_HASH),
      judge: account(e.JUDGE_EMAIL, e.JUDGE_PASSWORD_HASH),
      sessionSecret: e.SESSION_SECRET ?? null,
    },
    databaseUrl: e.DATABASE_URL ?? null,
    pgliteDir: e.PGLITE_DIR,
    runWorkerInline: e.RUN_WORKER_INLINE === undefined ? e.DATABASE_URL === undefined : e.RUN_WORKER_INLINE === 'true',
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    storeName: e.STORE_NAME,
    llm: {
      gemini: { apiKey: e.GEMINI_API_KEY ?? null, model: e.GEMINI_MODEL },
      groq: { apiKey: e.GROQ_API_KEY ?? null, model: e.GROQ_MODEL },
      timeoutMs: e.LLM_TIMEOUT_MS,
    },
  };
}
