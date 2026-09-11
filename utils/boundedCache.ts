/** 容量有界的 LRU 缓存；访问与写入时淘汰过期条目，命中不延长有效期。 */
export class BoundedCache<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();
  private readonly capacity: number;
  private readonly ttlMs: number;

  constructor(capacity: number, ttlMs: number) {
    this.capacity = capacity;
    this.ttlMs = ttlMs;
  }

  get size(): number { this.prune(); return this.entries.size; }
  clear(): void { this.entries.clear(); }
  delete(key: K): boolean { return this.entries.delete(key); }
  has(key: K): boolean { this.prune(); return this.entries.has(key); }

  get(key: K): V | undefined {
    this.prune();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    this.prune();
  }

  private prune(): void { pruneExpiredEntries(this.entries, this.capacity); }
}

export const pruneExpiredEntries = <K, V extends { expiresAt: number }>(
  entries: Map<K, V>, capacity: number,
): void => {
  const now = Date.now();
  for (const [key, value] of entries) {
    if (value.expiresAt <= now) entries.delete(key);
  }
  while (entries.size > capacity) {
    const first = entries.keys().next();
    if (first.done) break;
    entries.delete(first.value);
  }
};
