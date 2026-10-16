/** Masks an id for logging: '-' when empty, '****' for short ids, otherwise first 4 + '…' + last 4. */
export function maskId(id: string | null | undefined): string {
  if (!id) return '-';
  if (id.length <= 8) return '****';
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}
