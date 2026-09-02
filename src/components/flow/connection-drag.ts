/**
 * Dragging a wire is a MODE, not just a gesture.
 *
 * While a wire is out, the only question on the board is "where does this
 * land", and the board answers it two ways: the green/red wash on every card
 * and the pipe snapping to the slot it will land in. Everything else that
 * normally answers the pointer — edge highlights, edge labels, per-slot hover
 * scopes, the hop map — is a different question, and having it fire under a
 * held wire reads as the board arguing with itself.
 *
 * The flag is read imperatively from inside event handlers rather than
 * subscribed to. A value every node and every edge subscribes to would rebuild
 * the whole board twice per gesture, which is the exact cost ARCHITECTURE.md's
 * hover rules exist to avoid. Purely visual suppression rides on the
 * `factory-flow-board--wiring` class instead, so CSS does that half for free.
 */
let wiringConnection = false;
const wiringListeners = new Set<(active: boolean) => void>();

export function isWiringConnection(): boolean {
  return wiringConnection;
}

export function setWiringConnection(active: boolean): void {
  if (wiringConnection === active) {
    return;
  }
  wiringConnection = active;
  for (const listener of wiringListeners) {
    listener(active);
  }
}

/**
 * For the ONE component that must mount per wire gesture (the void-drop
 * ghost). Everything else keeps reading the flag imperatively - a value the
 * whole board subscribed to would rebuild it twice per gesture.
 */
export function onWiringConnectionChange(listener: (active: boolean) => void): () => void {
  wiringListeners.add(listener);
  return () => {
    wiringListeners.delete(listener);
  };
}

/**
 * When the last wire gesture ended. A drop on a pocket card is a mouseup,
 * and mouseups pair into double-clicks: without this, wiring a pocket could
 * count as "open the pocket" and yank the viewer inside mid-thought. Both
 * double-click paths (the card's own and React Flow's) check this window.
 */
let lastWireDropAt = 0;

export function markWireDrop(): void {
  lastWireDropAt = Date.now();
}

export function wasRecentWireDrop(withinMs = 500): boolean {
  return Date.now() - lastWireDropAt < withinMs;
}

export const WIRING_BOARD_CLASS = "factory-flow-board--wiring";
