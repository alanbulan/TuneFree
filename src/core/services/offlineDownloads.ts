import { AudioQuality, Song, getSongKey } from "../types";
import { getSongUrl } from "./resolver";
import { proxyFetch } from "./proxy";

// ==============================
// 离线下载库（与 Flutter 版 download manager / local resolver 对齐）
// 音频 Blob 存入 IndexedDB，播放时本地优先：先精确匹配音质，否则任意音质。
// meta 与 blob 分库存储，列表页只读 meta，避免把全部音频载入内存。
// ==============================

export interface OfflineDownloadMeta {
  key: string; // `${source}:${id}::${quality}`
  songKey: string; // `${source}:${id}`
  song: Song; // 歌曲元数据快照（含封面/歌词，便于离线展示）
  quality: string;
  mimeType: string;
  size: number;
  createTime: number;
}

export interface OfflinePlayback {
  url: string;
  lrc: string;
  pic: string;
  quality: string;
}

const DB_NAME = "tunefree_offline";
const DB_VERSION = 1;
const META_STORE = "meta";
const BLOB_STORE = "blobs";

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        const meta = db.createObjectStore(META_STORE, { keyPath: "key" });
        meta.createIndex("songKey", "songKey", { unique: false });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
};

const requestAsPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const buildRecordKey = (songKey: string, quality: string): string =>
  `${songKey}::${quality}`;

// ==============================
// 变更通知（下载/删除后让 UI 刷新）
// ==============================

type OfflineListener = () => void;
const listeners = new Set<OfflineListener>();

export const subscribeOfflineDownloads = (
  listener: OfflineListener,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notifyOfflineChanged = () => {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* ignore */
    }
  });
};

// ==============================
// 查询
// ==============================

export const listOfflineDownloads = async (): Promise<OfflineDownloadMeta[]> => {
  try {
    const db = await openDb();
    const tx = db.transaction(META_STORE, "readonly");
    const all = await requestAsPromise(
      tx.objectStore(META_STORE).getAll() as IDBRequest<OfflineDownloadMeta[]>,
    );
    return all.sort((a, b) => b.createTime - a.createTime);
  } catch {
    return [];
  }
};

const listMetaForSong = async (
  songKey: string,
): Promise<OfflineDownloadMeta[]> => {
  try {
    const db = await openDb();
    const tx = db.transaction(META_STORE, "readonly");
    const index = tx.objectStore(META_STORE).index("songKey");
    return await requestAsPromise(
      index.getAll(songKey) as IDBRequest<OfflineDownloadMeta[]>,
    );
  } catch {
    return [];
  }
};

/** 某首歌已离线缓存的音质列表（下载弹窗用于显示「已缓存」标记） */
export const getOfflineQualities = async (
  song: Pick<Song, "id" | "source">,
): Promise<string[]> => {
  const metas = await listMetaForSong(getSongKey(song));
  return metas.map((meta) => meta.quality);
};

// ==============================
// 本地优先播放解析
// 与 Flutter LocalPlaybackResolver 一致：先精确匹配音质，否则任意已缓存音质。
// ==============================

// 每条记录复用同一个 object URL，删除记录时统一 revoke。
const objectUrlCache = new Map<string, string>();

const getRecordObjectUrl = async (key: string): Promise<string | null> => {
  const cached = objectUrlCache.get(key);
  if (cached) return cached;

  try {
    const db = await openDb();
    const tx = db.transaction(BLOB_STORE, "readonly");
    const blob = await requestAsPromise(
      tx.objectStore(BLOB_STORE).get(key) as IDBRequest<Blob | undefined>,
    );
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    objectUrlCache.set(key, url);
    return url;
  } catch {
    return null;
  }
};

export const resolveOfflinePlayback = async (
  song: Song,
  quality: AudioQuality | string,
): Promise<OfflinePlayback | null> => {
  const metas = await listMetaForSong(getSongKey(song));
  if (metas.length === 0) return null;

  const exact = metas.find((meta) => meta.quality === quality);
  const record = exact || metas[0];

  const url = await getRecordObjectUrl(record.key);
  if (!url) {
    // blob 丢失（如存储被清理）：清掉孤儿 meta，回落在线播放
    await deleteOfflineDownload(record.key).catch(() => undefined);
    return null;
  }

  return {
    url,
    lrc: song.lrc || record.song.lrc || "",
    pic: song.pic || record.song.pic || "",
    quality: record.quality,
  };
};

// ==============================
// 下载与删除
// ==============================

const inferMimeType = (contentType: string | null, quality: string): string => {
  if (contentType && contentType.startsWith("audio/")) return contentType;
  return quality === "flac" || quality === "flac24bit"
    ? "audio/flac"
    : "audio/mpeg";
};

const fetchAudioBlob = async (
  url: string,
): Promise<{ blob: Blob; contentType: string | null }> => {
  // 网易/QQ/GD 源 CDN 带 CORS 头，可直接 fetch；酷我 CDN 不支持 CORS，走代理。
  try {
    const resp = await fetch(url, { credentials: "omit", mode: "cors" });
    if (resp.ok) {
      return { blob: await resp.blob(), contentType: resp.headers.get("Content-Type") };
    }
  } catch {
    /* 回落代理 */
  }

  const proxied = await proxyFetch(url, {}, 60000);
  if (proxied?.ok) {
    return {
      blob: await proxied.blob(),
      contentType: proxied.headers.get("Content-Type"),
    };
  }
  throw new Error("audio download failed");
};

export type OfflineDownloadResult = "saved" | "exists";

/** 下载到离线库；已存在同曲同音质时直接返回 exists */
export const downloadSongOffline = async (
  song: Song,
  quality: AudioQuality | string,
): Promise<OfflineDownloadResult> => {
  const songKey = getSongKey(song);
  const key = buildRecordKey(songKey, String(quality));

  const existing = await listMetaForSong(songKey);
  if (existing.some((meta) => meta.key === key)) return "exists";

  const url = await getSongUrl(song.id, song.source, String(quality), song);
  if (!url) throw new Error("no playable url");

  const { blob, contentType } = await fetchAudioBlob(url);
  if (blob.size === 0) throw new Error("empty audio payload");

  // 快照歌曲元数据（剥离临时播放地址，保留封面/歌词供离线使用）
  const { url: _ignoredUrl, ...songMeta } = song;
  const meta: OfflineDownloadMeta = {
    key,
    songKey,
    song: songMeta as Song,
    quality: String(quality),
    mimeType: inferMimeType(contentType, String(quality)),
    size: blob.size,
    createTime: Date.now(),
  };

  const db = await openDb();
  const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
  tx.objectStore(META_STORE).put(meta);
  tx.objectStore(BLOB_STORE).put(blob, key);
  await txDone(tx);

  notifyOfflineChanged();
  return "saved";
};

export const deleteOfflineDownload = async (key: string): Promise<void> => {
  const db = await openDb();
  const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
  tx.objectStore(META_STORE).delete(key);
  tx.objectStore(BLOB_STORE).delete(key);
  await txDone(tx);

  const cachedUrl = objectUrlCache.get(key);
  if (cachedUrl) {
    URL.revokeObjectURL(cachedUrl);
    objectUrlCache.delete(key);
  }
  notifyOfflineChanged();
};

export const formatOfflineSize = (size: number): string => {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${size} B`;
};
