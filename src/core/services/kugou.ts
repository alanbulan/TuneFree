import { Song } from '../types';
import { calculateMD5 } from './gdStudioClient';
import { proxyFetchJson, throwIfAborted } from './proxy';

// ==============================
// 酷狗音乐 搜索接口
//
// 走 web 版搜索（complexsearch），需要按公开密钥对「按名排序后的参数」做 md5 签名；
// 请求经本地 CORS 代理发出（代理会带上浏览器 UA 与同源 Referer，酷狗只校验这两者）。
//
// 搜索结果里的 FileHash 系列字段既是洛雪 kg 音源要的 `musicInfo.hash` / `_types`，
// 也是本应用播放时的歌曲主键。
// ==============================

/** 酷狗 web 接口的公开签名密钥。 */
const KUGOU_SIGNATURE_SECRET = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const KUGOU_SEARCH_URL = 'https://complexsearch.kugou.com/v2/search/song';
const KUGOU_SEARCH_TIMEOUT_MS = 8_000;

const cleanText = (value: unknown): string =>
  String(value ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const randomHex32 = (): Promise<string> =>
  calculateMD5(`${Date.now()}-${Math.random()}-${Math.random()}`);

/** 酷狗签名：参数按名排序拼接，用密钥前后包裹后取 md5。 */
export const buildKugouSignature = async (params: Record<string, string>): Promise<string> => {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('');
  return calculateMD5(`${KUGOU_SIGNATURE_SECRET}${sorted}${KUGOU_SIGNATURE_SECRET}`);
};

/**
 * 摘出各音质对应的 file hash。
 *
 * 洛雪 kg 音源会读 `musicInfo._types[音质].hash`；只保留非空项，
 * 避免脚本拿到空 hash 去请求。
 */
export const buildKugouQualityHashes = (item: any): Record<string, { hash: string }> => {
  const mapping: Array<[string, unknown]> = [
    ['128k', item?.FileHash],
    ['320k', item?.HQFileHash],
    ['flac', item?.SQFileHash],
    ['flac24bit', item?.ResFileHash],
  ];
  const result: Record<string, { hash: string }> = {};
  for (const [quality, hash] of mapping) {
    const text = String(hash ?? '').trim();
    if (text) result[quality] = { hash: text };
  }
  return result;
};

const normalizeKugouSong = (item: any): Song | null => {
  const hash = String(item?.FileHash ?? '').trim();
  if (!hash) return null;
  const singers = Array.isArray(item?.Singers) && item.Singers.length > 0
    ? item.Singers.map((singer: any) => cleanText(singer?.name)).filter(Boolean).join(' / ')
    : cleanText(item?.SingerName);
  // 封面模板形如 http://imge.kugou.com/stdmusic/{size}/xxx.jpg，统一升级为 https 大图。
  const image = String(item?.Image ?? '').replace('{size}', '480').replace(/^http:/, 'https:');
  return {
    id: hash,
    name: cleanText(item?.SongName),
    artist: singers,
    album: cleanText(item?.AlbumName),
    pic: image.startsWith('https://') ? image : '',
    source: 'kugou',
    hash,
    albumId: item?.AlbumID ? String(item.AlbumID) : undefined,
    qualityHashes: buildKugouQualityHashes(item),
  };
};

/**
 * 酷狗搜索。
 *
 * @param keyword 搜索关键词
 * @param page    页码（从 1 开始）
 * @param limit   每页数量
 */
export const searchKugou = async (
  keyword: string,
  page: number = 1,
  limit: number = 30,
  signal?: AbortSignal,
): Promise<Song[]> => {
  const [mid, uuid] = await Promise.all([randomHex32(), randomHex32()]);
  const params: Record<string, string> = {
    appid: '1014',
    clientver: '20000',
    clienttime: String(Date.now()),
    mid,
    uuid,
    dfid: '-',
    keyword,
    page: String(page),
    pagesize: String(limit),
    platform: 'WebFilter',
    userid: '0',
    iscorrection: '1',
    privilege_filter: '0',
    filter: '10',
    srcappid: '2919',
  };
  const signature = await buildKugouSignature(params);
  const url = `${KUGOU_SEARCH_URL}?${new URLSearchParams({ ...params, signature })}`;

  const data = await proxyFetchJson(url, KUGOU_SEARCH_TIMEOUT_MS, signal);
  throwIfAborted(signal);
  const lists = data?.data?.lists;
  if (!Array.isArray(lists)) throw new Error('酷狗搜索响应不可用');
  return lists
    .map(normalizeKugouSong)
    .filter((song): song is Song => song !== null);
};
