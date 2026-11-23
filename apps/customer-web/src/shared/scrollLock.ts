/**
 * Page scrolling stays locked while at least one owner (an open sheet) holds a
 * lock. Each owner holds its own, so an owner that releases late, or that is
 * removed while open (its route left), releases only itself; the element's
 * previous overflow comes back when the last lock is released. Releasing twice,
 * or releasing an owner that holds no lock, changes nothing.
 */
export interface ScrollLock {
  readonly lock: (owner: object) => void;
  readonly release: (owner: object) => void;
}

export function createScrollLock(target: () => { overflow: string }): ScrollLock {
  const owners = new Set<object>();
  let overflowBeforeLock = '';
  return {
    lock(owner) {
      const style = target();
      if (owners.size === 0) overflowBeforeLock = style.overflow;
      owners.add(owner);
      style.overflow = 'hidden';
    },
    release(owner) {
      if (!owners.delete(owner) || owners.size > 0) return;
      target().overflow = overflowBeforeLock;
    },
  };
}
