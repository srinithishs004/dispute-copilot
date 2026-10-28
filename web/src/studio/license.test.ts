import { describe, expect, it, vi } from 'vitest';

const setLicenseKey = vi.fn();
vi.mock('ag-studio', () => ({ AgStudioLicenseManager: { setLicenseKey } }));

describe('applyStudioLicense', () => {
  it('runs as a trial without a key, then sets a key once', async () => {
    const { applyStudioLicense } = await import('./license');
    expect(applyStudioLicense('')).toBe(false);
    expect(applyStudioLicense(undefined)).toBe(false);
    expect(setLicenseKey).not.toHaveBeenCalled();
    expect(applyStudioLicense(' key-123 ')).toBe(true);
    expect(setLicenseKey).toHaveBeenCalledWith('key-123');
    // A second call does not set it again (Studio warns on a changed key).
    applyStudioLicense('other');
    expect(setLicenseKey).toHaveBeenCalledTimes(1);
  });
});
