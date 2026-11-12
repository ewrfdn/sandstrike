/**
 * Tiny global event bus. Gameplay emits, UI/audio/effects listen.
 * Never use this for per-frame hot data — use direct calls for that.
 */
export const bus = new EventTarget();

export function emit(type, detail = {}) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

export function on(type, handler) {
  const wrapped = (event) => handler(event.detail ?? {});
  bus.addEventListener(type, wrapped);
  return () => bus.removeEventListener(type, wrapped);
}

export function once(type, handler) {
  const off = on(type, (detail) => {
    off();
    handler(detail);
  });
  return off;
}
