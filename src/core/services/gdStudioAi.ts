import type { Song } from '../types';
import { fetchGDStudioData, fetchWithTimeout, GDStudioApiError } from './gdStudioClient';
import type { GdStudioMusicSource, GdStudioTrack } from './gdStudioModel';
import { getTrackKey, joinArtists, normalizeGDStudioSource, rememberTrackMeta } from './gdStudioModel';
import { fixUrl } from './utils';

const POLLINATIONS_TIMEOUT_MS = 12_000;

type CoverResolver = (
  source: GdStudioMusicSource,
  picId: string,
  size: 300 | 500,
) => Promise<string>;

const fetchOfficialRecommendations = async (
  keyword: string,
  source: GdStudioMusicSource,
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
  source: GdStudioMusicSource,
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
  source: GdStudioMusicSource,
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
  source: GdStudioMusicSource,
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
  source: GdStudioMusicSource,
  count: number,
): Promise<GdStudioTrack[]> => {
  const official = await fetchOfficialRecommendations(keyword, source, count);
  if (Array.isArray(official) && official.length > 0) return official;
  const pollinations = await fetchPollinationsRecommendations(keyword, source);
  if (Array.isArray(pollinations) && pollinations.length > 0) return pollinations;
  const fallback = await fetchFallbackSearch(keyword, source, count);
  return Array.isArray(fallback) ? fallback : [];
};

const resolveItemSource = (item: GdStudioTrack): GdStudioMusicSource => {
  const source = normalizeGDStudioSource(item.source);
  if (!source) throw new GDStudioApiError('BAD_RESPONSE', 200, 'recommendation track source is invalid');
  return source;
};

export const enrichAIRecommendationCovers = async (
  tracks: GdStudioTrack[],
  resolveCover: CoverResolver,
): Promise<void> => {
  await Promise.all(tracks.map(async (item) => {
    const picId = String(item.pic_id || '').trim();
    const songId = String(item.id || item.url_id || '').trim();
    if (!picId || !songId || picId.startsWith('http') || picId.startsWith('//')) return;
    const cover = await resolveCover(resolveItemSource(item), picId, 500);
    if (cover) item.pic_id = cover;
  }));
};

export const mapAIRecommendationTracks = (tracks: GdStudioTrack[]): Song[] => {
  const songs: Song[] = [];
  const seen = new Set<string>();
  for (const item of tracks) {
    const id = String(item.id || '').trim();
    if (!id) throw new GDStudioApiError('BAD_RESPONSE', 200, 'recommendation track id is required');
    const picId = String(item.pic_id || '').trim();
    const lyricId = String(item.lyric_id || id).trim();
    const urlId = String(item.url_id || id).trim();
    const pic = picId.startsWith('http') || picId.startsWith('//') ? fixUrl(picId) : '';
    const source = resolveItemSource(item);
    const key = getTrackKey(id, source);
    if (seen.has(key)) continue;
    seen.add(key);
    rememberTrackMeta(id, source, { pic, picId, lyricId, urlId });
    songs.push({
      id,
      name: String(item.name || ''),
      artist: joinArtists(item.artist),
      album: String(item.album || ''),
      pic,
      picId,
      lyricId,
      urlId,
      source,
    });
  }
  return songs;
};
