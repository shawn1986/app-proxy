import type { SessionRecord } from "../sessions/types.js";

export function createSessionEventBus() {
  const handlers = new Set<(session: SessionRecord) => void>();

  return {
    publish(session: SessionRecord) {
      for (const handler of handlers) {
        try {
          handler(session);
        } catch {}
      }
    },
    subscribe(handler: (session: SessionRecord) => void) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
