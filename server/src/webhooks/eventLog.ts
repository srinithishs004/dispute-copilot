export type StoredEvent = {
  id: string;
  eventType: string;
  resourceId: string | null;
  receivedAt: string;
  raw: unknown;
};

export type EventLog = {
  add(e: StoredEvent): boolean;
  list(): StoredEvent[];
};

export function createEventLog(max = 50): EventLog {
  const events: StoredEvent[] = [];
  const ids = new Set<string>();
  return {
    add(e) {
      if (ids.has(e.id)) return false;
      ids.add(e.id);
      events.push(e);
      while (events.length > max) {
        const dropped = events.shift();
        if (dropped) ids.delete(dropped.id);
      }
      return true;
    },
    list() {
      return [...events];
    },
  };
}
