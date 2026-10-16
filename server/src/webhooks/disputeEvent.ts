/** The dispute id a webhook event refers to: `resource.dispute_id`, else `resource.id` for CUSTOMER.DISPUTE.* events. */
export function disputeIdFromEvent(event: unknown): string | null {
  if (typeof event !== 'object' || event === null) return null;
  const { event_type: eventType, resource } = event as { event_type?: unknown; resource?: unknown };
  if (typeof resource !== 'object' || resource === null) return null;
  const r = resource as { dispute_id?: unknown; id?: unknown };
  if (typeof r.dispute_id === 'string') return r.dispute_id;
  if (typeof eventType === 'string' && eventType.startsWith('CUSTOMER.DISPUTE.') && typeof r.id === 'string') {
    return r.id;
  }
  return null;
}
