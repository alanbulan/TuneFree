import type { Song } from '../types';
import { fetchGDStudioData, fetchWithTimeout } from './gdStudioClient';
import type { GdStudioSource, GdStudioTrack } from './gdStudioModel';
import { joinArtists, rememberTrackMeta } from './gdStudioModel';
import { fixUrl } from './utils';

const POLLINATIONS_TIMEOUT_MS = 12_000;

type CoverResolver = (
  source: GdStudioSource,
  picId: string,
  size: 300 | 500,
  songId: string | number,
) => Promise<string>;

const fetchOfficialRecommendations = async (
  keyword: string,
  source: GdStudioSource,
  count: number,
): Promise<GdStudioTrack[] | null> => {
  try {
    return await fetchGDStudioData<GdStudioTrack[]>({
      types: 'embeat_agent', count, source, pages: 1, name: keyword,
    });
  } catch (error) {
    console.warn('[GDStudio] embeat_agent failed, trying Pollinations AI fallback:', error);
    return null;
  }
};

const searchRecommendedTracks = async (
  recommendations: Array<{ name?: any; artist?: any }>,
  source: GdStudioSource,
): Promise<GdStudioTrack[]> => {
  const results = await Promise.all(recommendations.map(async (recommendation) => {
    try {
      const name = `${recommendation.name} ${recommendation.artist}`;
      const tracks = await fetchGDStudioData<GdStudioTrack[]>({
        types: 'search', count: 1, source, pages: 1, name,
      });
      return Array.isArray(tracks) && tracks.length > 0 ? tracks[0] : null;
    } catch {
      return null;
    }
  }));
  return results.filter((track): track is GdStudioTrack => track !== null);
};

const fetchPollinationsRecommendations = async (
  keyword: string,
  source: GdStudioSource,
): Promise<GdStudioTrack[] | null> => {
  try {
    const prompt = `[No reasoning] 严格禁止任何思考链。请根据意境“${keyword}”，推荐4首适合的中文歌曲。以极简的纯JSON数组格式返回：[{"name":"歌名","artist":"歌手"}]。绝对不要有任何解释、推理思考、Markdown格式标记或多余字眼！`;
    const response = await fetchWithTimeout('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
    }, POLLINATIONS_TIMEOUT_MS);
    if (!response.ok) return null;
    const text = await response.text();
    const parsed = JSON.parse(text);
    const content = parsed.content || text;
    const match = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!match) return null;
    const recommendations = JSON.parse(match[0]);
    return Array.isArray(recommendations) && recommendations.length > 0
      ? searchRecommendedTracks(recommendations, source)
      : null;
  } catch (error) {
    console.warn('[GDStudio] Pollinations AI fallback failed:', error);
    return null;
  }
};

const fetchFallbackSearch = async (
  keyword: string,
  source: GdStudioSource,
  count: number,
): Promise<GdStudioTrack[] | null> => {
  try {
    const name = keyword.length > 6 ? keyword.slice(0, 4) : keyword;
    return await fetchGDStudioData<GdStudioTrack[]>({
      types: 'search', count, source, pages: 1, name,
    });
  } catch (error) {
    console.error('[GDStudio] Ultimate fallback search failed:', error);
    return null;
  }
};

export const loadAIRecommendationTracks = async (
  keyword: string,
  source: GdStudioSource,
  count: number,
): Promise<GdStudioTrack[]> => {
  const official = await fetchOfficialRecommendations(keyword, source, count);
  if (Array.isArray(official) && official.length > 0) return official;
  const pollinations = await fetchPollinationsRecommendations(keyword, source);
  if (Array.isArray(pollinations) && pollinations.length > 0) return pollinations;
  const fallback = await fetchFallbackSearch(keyword, source, count);
  return Array.isArray(fallback) ? fallback : [];
};

const resolveItemSource = (item: GdStudioTrack): string => {
  const rawSource = String(item.source || '').trim();
  if (!rawSource || rawSource === 'embeat') return 'netease';
  return rawSource === 'tencent' ? 'qq' : rawSource;
};

export const enrichAIRecommendationCovers = async (
  tracks: GdStudioTrack[],
  resolveCover: CoverResolver,
): Promise<void> => {
  await Promise.all(tracks.map(async (item) => {
    const picId = String(item.pic_id || '').trim();
    const songId = String(item.id || item.url_id || '').trim();
    if (!picId || !songId || picId.startsWith('http') || picId.startsWith('//')) return;
    try {
      const cover = await resolveCover(resolveItemSource(item) as GdStudioSource, picId, 500, songId);
      if (cover) item.pic_id = cover;
    } catch {
      // 保持原降级行为
    }
  }));
};

export const mapAIRecommendationTracks = (tracks: GdStudioTrack[]): Song[] =>
  tracks.map((item) => {
    const id = String(item.id || item.url_id || item.lyric_id || '').trim();
    const picId = String(item.pic_id || '').trim();
    const lyricId = String(item.lyric_id || id).trim();
    const urlId = String(item.url_id || id).trim();
    const pic = picId.startsWith('http') || picId.startsWith('//') ? fixUrl(picId) : '';
    const source = resolveItemSource(item);
    if (id) rememberTrackMeta(id, source, { pic, picId, lyricId, urlId });
    return {
      id: id || `temp_${Math.random().toString(36).slice(2)}`,
      name: String(item.name || ''),
      artist: joinArtists(item.artist),
      album: String(item.album || ''),
      pic,
      picId,
      lyricId,
      urlId,
      source,
    };
  });
