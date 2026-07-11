import type { Song } from '../types';

export const TUNEHUB_API_BASE = 'https://tunehub.sayqz.com/api';

export type PlaylistImportErrorCode =
  | 'invalidInput'
  | 'sourceMismatch'
  | 'unsupportedSource'
  | 'emptyPlaylist'
  | 'network'
  | 'remoteFormat';

export class PlaylistImportError extends Error {
  constructor(public code: PlaylistImportErrorCode, message?: string) {
    super(message || code);
    this.name = 'PlaylistImportError';
  }
}

export const PLAYLIST_IMPORT_ERROR_MESSAGES: Record<PlaylistImportErrorCode, string> = {
  invalidInput: '无法识别歌单链接或 ID',
  sourceMismatch: '链接与所选音源不一致',
  unsupportedSource: '暂不支持该音源歌单导入',
  emptyPlaylist: '歌单为空或暂时无法访问',
  network: '网络异常，导入失败，请稍后重试',
  remoteFormat: '解析歌单数据失败',
};

export const getPlaylistImportErrorMessage = (error: unknown): string =>
  error instanceof PlaylistImportError
    ? PLAYLIST_IMPORT_ERROR_MESSAGES[error.code]
    : PLAYLIST_IMPORT_ERROR_MESSAGES.network;

export const PLAYLIST_IMPORT_SOURCES = [
  { value: 'netease', label: '网易云', placeholder: '歌单链接或 ID，如 music.163.com/playlist?id=...' },
  { value: 'qq', label: 'QQ音乐', placeholder: '歌单链接或 ID，如 y.qq.com/.../playlist/...' },
  { value: 'kuwo', label: '酷我音乐', placeholder: '歌单链接或 ID，如 kuwo.cn/playlist_detail/...' },
] as const;

export interface ImportedPlaylistPayload {
  name: string;
  songs: Song[];
}

const detectSource = (input: string): string | null => {
  const lower = input.toLowerCase();
  if (lower.includes('music.163.com') || lower.includes('y.music.163.com')) return 'netease';
  if (lower.includes('y.qq.com') || lower.includes('i.y.qq.com')) return 'qq';
  if (lower.includes('kuwo.cn')) return 'kuwo';
  return null;
};

const firstGroup = (input: string, pattern: RegExp) => pattern.exec(input)?.[1] || null;
const rawId = (input: string) => (/^[A-Za-z0-9_-]+$/.test(input) ? input : null);
const extractors: Record<string, (input: string) => string | null> = {
  netease: (input) => firstGroup(input, /(?:[?&#]|\/)id=(\d+)/)
    || firstGroup(input, /playlist\?id=(\d+)/)
    || firstGroup(input, /\/playlist\/(\d+)/)
    || rawId(input),
  qq: (input) => firstGroup(input, /(?:[?&#])(?:dissid|id|dirid)=([A-Za-z0-9_-]+)/)
    || firstGroup(input, /\/playlist\/([A-Za-z0-9_-]+)/)
    || rawId(input),
  kuwo: (input) => firstGroup(input, /(?:[?&#])pid=([A-Za-z0-9_-]+)/)
    || firstGroup(input, /\/playlist_detail\/(\d+)/)
    || firstGroup(input, /\/playlist\/(\d+)/)
    || rawId(input),
};

export const parsePlaylistImportInput = (source: string, input: string) => {
  const normalizedSource = source.trim();
  const trimmedInput = input.trim();
  if (!trimmedInput) throw new PlaylistImportError('invalidInput');
  const detected = detectSource(trimmedInput);
  if (detected && detected !== normalizedSource) throw new PlaylistImportError('sourceMismatch');
  const extractor = extractors[normalizedSource];
  if (!extractor) throw new PlaylistImportError('unsupportedSource');
  const id = extractor(trimmedInput);
  if (!id) throw new PlaylistImportError('invalidInput');
  return { source: normalizedSource, id };
};
