type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type Validator<T> = (value: unknown) => T | null;

const getStorage = (storage?: StorageLike): StorageLike | null => {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const backupCorruptStorage = (
  key: string,
  rawValue: string,
  storage?: StorageLike,
): void => {
  const target = getStorage(storage);
  if (!target) return;
  try {
    target.setItem(`${key}_corrupt_${Date.now()}`, rawValue);
  } catch {
    /* ignore corrupt-backup failures */
  }
};

export const safeGetItem = (
  key: string,
  fallback: string | null = null,
  storage?: StorageLike,
): string | null => {
  const target = getStorage(storage);
  if (!target) return fallback;
  try {
    return target.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

export const safeSetItem = (
  key: string,
  value: string,
  storage?: StorageLike,
): boolean => {
  const target = getStorage(storage);
  if (!target) return false;
  try {
    target.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`[safeStorage] Failed to write ${key}:`, error);
    return false;
  }
};

export const safeRemoveItem = (key: string, storage?: StorageLike): boolean => {
  const target = getStorage(storage);
  if (!target) return false;
  try {
    target.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`[safeStorage] Failed to remove ${key}:`, error);
    return false;
  }
};

export const safeGetJson = <T>(
  key: string,
  fallback: T,
  validate?: Validator<T>,
  options: { backupCorrupt?: boolean; storage?: StorageLike } = {},
): T => {
  const rawValue = safeGetItem(key, null, options.storage);
  if (!rawValue) return fallback;

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!validate) return parsed as T;
    const normalized = validate(parsed);
    if (normalized !== null) return normalized;
  } catch {
    /* backed up below */
  }

  if (options.backupCorrupt) {
    backupCorruptStorage(key, rawValue, options.storage);
  }
  return fallback;
};

export const safeSetJson = (
  key: string,
  value: unknown,
  storage?: StorageLike,
): boolean => {
  try {
    return safeSetItem(key, JSON.stringify(value), storage);
  } catch (error) {
    console.warn(`[safeStorage] Failed to serialize ${key}:`, error);
    return false;
  }
};
