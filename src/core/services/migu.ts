import { Song } from '../types';
import { proxyFetchJson, throwIfAborted } from './proxy';

// ==============================
// 咪咕音乐 搜索接口
//
// 走移动端搜索接口（MIGUM3.0 search_all），请求经本地 CORS 代理发出即可，
// 不需要额外签名；结果里的 `copyrightId` 就是洛雪 mg 音源要的 `musicInfo.copyrightId`。
// ==============================

const MIGU_SEARCH_URL = 'https://c.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do';
const MIGU_SEARCH_TIMEOUT_MS = 8_000;
const MIGU_SEARCH_SWITCH = '{"song":1}';

const cleanText = (value: unknown): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** 咪咕封面取最大尺寸（imgSizeType 03），退回第一张。 */
const pickMiguCover = (item: any): string => {
  const items = Array.isArray(item?.imgItems) ? item.imgItems : [];
  const preferred = items.find((entry: any) => entry?.imgSizeType === '03') ?? items[0];
  const image = String(preferred?.img ?? '');
  return image.startsWith('https://') ? image : '';
};

const normalizeMiguSong = (item: any): Song | null => {
  // copyrightId 是 mg 音源解析时用的主键；缺失时退回资源 id，至少还能参与跨源兜底。
  const id = String(item?.copyrightId || item?.contentId || item?.id || '').trim();
  if (!id) return null;
  const singers = Array.isArray(item?.singers)
    ? item.singers.map((singer: any) => cleanText(singer?.name)).filter(Boolean).join(' / ')
    : '';
  return {
    id,
    name: cleanText(item?.name),
    artist: singers,
    album: '',
    pic: pickMiguCover(item),
    source: 'migu',
  };
};

/**
 * 咪咕搜索。
 *
 * @param keyword 搜索关键词
 * @param page    页码（从 1 开始）
 * @param limit   每页数量
 */
export const searchMigu = async (
  keyword: string,
  page: number = 1,
  limit: number = 30,
  signal?: AbortSignal,
): Promise<Song[]> => {
  const url =
    `${MIGU_SEARCH_URL}?ua=Android_migu&version=6.0.1.0` +
    `&text=${encodeURIComponent(keyword)}&pageNo=${page}&pageSize=${limit}` +
    `&searchSwitch=${encodeURIComponent(MIGU_SEARCH_SWITCH)}`;

  const data = await proxyFetchJson(url, MIGU_SEARCH_TIMEOUT_MS, signal);
  throwIfAborted(signal);
  const list = data?.songResultData?.result;
  if (!Array.isArray(list)) throw new Error('咪咕搜索响应不可用');
  return list
    .map(normalizeMiguSong)
    .filter((song): song is Song => song !== null);
};
