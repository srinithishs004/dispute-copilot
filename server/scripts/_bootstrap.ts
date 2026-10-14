import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { createPayPalClient, PayPalError, type PayPalClient } from '../src/paypal/client.js';

const ENV_PATH = fileURLToPath(new URL('../../.env', import.meta.url));

/** Positive decimal with at most 2 decimals, e.g. "25" or "25.00". Returns the string or null. */
export function parseAmount(raw: string | undefined): string | null {
  if (!raw || !/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  return Number(raw) > 0 ? raw : null;
}

export function usageAndExit(usage: string): never {
  console.error(`Usage: ${usage}`);
  process.exit(1);
}

/** Loads repo-root .env (if present), builds a sandbox client. Exits 1 with a friendly message on bad config. */
export function bootstrap(): PayPalClient {
  try {
    process.loadEnvFile(ENV_PATH);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  try {
    return createPayPalClient(loadConfig(process.env).paypal);
  } catch (err) {
    console.error(`Config error: ${(err as Error).message}`);
    console.error(`Fill in ${ENV_PATH} (see .env.example) and try again.`);
    process.exit(1);
  }
}

/** status/name/debug_id plus PayPal's issue codes (from details[]) — never headers or secrets. */
export function formatPayPalError(err: PayPalError): string {
  const lines = [`PayPal error: status=${err.status} name=${err.name} debug_id=${err.debugId ?? 'n/a'}`];
  const details = (err.body as { details?: { issue?: string; description?: string }[] } | null)?.details;
  if (Array.isArray(details)) {
    for (const d of details) lines.push(`  - ${d.issue ?? 'UNKNOWN'}: ${d.description ?? ''}`.trimEnd());
  }
  return lines.join('\n');
}

/** Runs a script body; prints PayPalError as status/name/debugId only, never headers or secrets. */
export async function run(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (err) {
    if (err instanceof PayPalError) {
      console.error(formatPayPalError(err));
    } else {
      console.error(`Error: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}
