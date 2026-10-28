import { AgStudioLicenseManager } from 'ag-studio';

let applied = false;

/**
 * Sets the AG Studio licence key once, before the first Studio renders. The key is a public client
 * key baked in at build time (VITE_AG_STUDIO_LICENSE_KEY). Without one, Studio runs as a trial: all
 * features work and a "For Trial Use Only" watermark shows on hosts other than localhost.
 * Returns whether a key was set.
 */
export function applyStudioLicense(key: string | undefined = import.meta.env.VITE_AG_STUDIO_LICENSE_KEY): boolean {
  const k = key?.trim();
  if (!k) return false;
  if (!applied) {
    AgStudioLicenseManager.setLicenseKey(k);
    applied = true;
  }
  return true;
}
