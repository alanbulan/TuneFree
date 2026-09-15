import { deflate, inflate } from 'pako';
import { safeGetJson, safeSetJson } from '../../utils/safeStorage';
import { calculateMD5 } from '../gdStudioClient';
import { parseScriptMeta, validateScriptContent } from './scriptMeta';

/**
 * 用户导入音源的持久化。
 *
 * 存的是「压缩后的脚本原文」：`currentScriptInfo.rawScript` 必须是原文
 * （少数脚本会拿它做自校验），因此不能只留元数据。整体放在 localStorage 的
 * 单个键里，压缩后 20 多个音源约 200 KB，远低于配额。
 */

export const MUSIC_SOURCES_STORAGE_KEY = 'tunefree_music_sources';

/** 全部脚本原文的合计上限，超出时拒绝导入并提示用户先删掉一些。 */
export const TOTAL_SCRIPT_BYTES_LIMIT = 3.5 * 1024 * 1024;

export interface MusicSourceRecord {
  /** 内容 md5，作为稳定主键（同内容重复导入视为同一音源）。 */
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  homepage: string;
  fileName: string;
  /** deflate + base64 后的脚本原文。 */
  content: string;
  enabled: boolean;
  /** 是否允许在跨源兜底时按歌名匹配（默认关闭，见音源管理页说明）。 */
  nameMatchFallback: boolean;
  importedAt: number;
  /** 原文字节数，用于展示与总量控制。 */
  bytes: number;
  /** 内置脚本（不可删除、不可停用；不落盘）。 */
  builtin?: boolean;
}

interface StoredSources {
  version: number;
  sources: MusicSourceRecord[];
}

const STORAGE_VERSION = 1;

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunk = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

const base64ToBytes = (text: string): Uint8Array => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export const compressScript = (code: string): string =>
  bytesToBase64(deflate(new TextEncoder().encode(code)));

export const decompressScript = (payload: string): string =>
  new TextDecoder('utf-8').decode(inflate(base64ToBytes(payload)));

const isRecord = (value: unknown): value is MusicSourceRecord => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MusicSourceRecord>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.content === 'string' &&
    typeof candidate.fileName === 'string'
  );
};

const normalizeRecord = (value: unknown): MusicSourceRecord | null => {
  if (!isRecord(value)) return null;
  return {
    id: value.id,
    name: typeof value.name === 'string' && value.name ? value.name : value.fileName,
    version: typeof value.version === 'string' ? value.version : '',
    author: typeof value.author === 'string' ? value.author : '',
    description: typeof value.description === 'string' ? value.description : '',
    homepage: typeof value.homepage === 'string' ? value.homepage : '',
    fileName: value.fileName,
    content: value.content,
    enabled: value.enabled !== false,
    nameMatchFallback: value.nameMatchFallback === true,
    importedAt: typeof value.importedAt === 'number' ? value.importedAt : 0,
    bytes: typeof value.bytes === 'number' ? value.bytes : 0,
  };
};

export const loadSourceRecords = (): MusicSourceRecord[] =>
  safeGetJson<StoredSources>(
    MUSIC_SOURCES_STORAGE_KEY,
    { version: STORAGE_VERSION, sources: [] },
    (value) => {
      if (!value || typeof value !== 'object') return null;
      const sources = (value as Partial<StoredSources>).sources;
      if (!Array.isArray(sources)) return null;
      return {
        version: STORAGE_VERSION,
        sources: sources.map(normalizeRecord).filter((item): item is MusicSourceRecord => item !== null),
      };
    },
    { backupCorrupt: true },
  ).sources;

export type PersistResult = { ok: true } | { ok: false; error: string };

export const persistSourceRecords = (records: MusicSourceRecord[]): PersistResult => {
  const payload: StoredSources = { version: STORAGE_VERSION, sources: records };
  const written = safeSetJson(MUSIC_SOURCES_STORAGE_KEY, payload);
  return written
    ? { ok: true }
    : { ok: false, error: '写入本地存储失败（可能已超出配额），请删除部分音源后重试' };
};

export type CreateRecordResult =
  | { ok: true; record: MusicSourceRecord }
  | { ok: false; reason: string };

/**
 * 由导入的文本生成记录：校验体积、解析头部、按内容 md5 生成主键。
 */
export const createSourceRecord = async (
  fileName: string,
  rawCode: string,
): Promise<CreateRecordResult> => {
  const validation = validateScriptContent(rawCode);
  if (!validation.ok) return validation;
  const code = rawCode.charCodeAt(0) === 0xfeff ? rawCode.slice(1) : rawCode;
  const bytes = new TextEncoder().encode(code).length;
  const meta = parseScriptMeta(code, fileName);
  return {
    ok: true,
    record: {
      id: await calculateMD5(code),
      name: meta.name,
      version: meta.version,
      author: meta.author,
      description: meta.description,
      homepage: meta.homepage,
      fileName,
      content: compressScript(code),
      enabled: true,
      nameMatchFallback: false,
      importedAt: Date.now(),
      bytes,
    },
  };
};

/** 已有记录占用的原文总字节数。 */
export const totalScriptBytes = (records: MusicSourceRecord[]): number =>
  records.reduce((total, record) => total + record.bytes, 0);
