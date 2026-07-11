import type { Song } from '../types';
import { fetchGDStudioData, fetchWithTimeout, GDStudioApiError } from './gdStudioClient';
import type { GdStudioSource, GdStudioTrack } from './gdStudioModel';
import {
  getTrackKey,
  joinArtists,
  normalizeGDStudioSource,
  rememberTrackMeta,
} from './gdStudioModel';
import { fixUrl } from './utils';

const POLLINATIONS_TIMEOUT_MS = 12_000;
const POLLINATIONS_OPENAI_URL = 'https://text.pollinations.ai/openai';
const POLLINATIONS_RECOMMENDATION_LIMIT = 4;
const REQUIRED_TRACK_FIELDS: Array<keyof GdStudioTrack> = [
  'id', 'name', 'artist', 'album', 'pic_id', 'url_id', 'lyric_id', 'source',
];

type CoverResolver = (
  source: GdStudioSource,
  picId: string,
  size: 300 | 500,
  songId: string | number,
) => Promise<string>;

type PollinationsRecommendation = { name: string; artist: string };

const badResponse = (detail: string): GDStudioApiError =>
  new GDStudioApiError('BAD_RESPONSE', 200, detail);

const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
};

const normalizeComparableText = (value: string): string => value
  .toLowerCase()
  .replace(/[（(].*?[)）]/g, '')
  .replace(/[\s·・.。\-_—–,，、/\\|:：]+/g, '')
  .trim();

const isRecommendedTrackMatch = (
  track: GdStudioTrack,
  recommendation: PollinationsRecommendation,
): boolean => {
  const expectedName = normalizeComparableText(recommendation.name);
  const actualName = normalizeComparableText(String(track.name));
  return actualName === expectedName
    || actualName.includes(expectedName)
    || expectedName.includes(actualName);
};

const validateTrack = (value: unknown, context: string): GdStudioTrack => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badResponse(`${context} track must be an object`);
  }
  const track = value as GdStudioTrack;
  const missing = REQUIRED_TRACK_FIELDS.filter((field) => !(field in track));
  if (missing.length > 0) {
    throw badResponse(`${context} track is missing fields: ${missing.join(', ')}`);
  }
  const artistValid = typeof track.artist === 'string'
    || (Array.isArray(track.artist) && track.artist.every((artist) => typeof artist === 'string'));
  if (
    !artistValid
    || typeof track.album !== 'string'
    || typeof track.pic_id !== 'string'
    || !['string', 'number'].includes(typeof track.id)
    || typeof track.name !== 'string'
    || !['string', 'number'].includes(typeof track.url_id)
    || !['string', 'number'].includes(typeof track.lyric_id)
    || !normalizeGDStudioSource(track.source)
  ) {
    throw badResponse(`${context} track fields have invalid types`);
  }
  if (!String(track.id).trim() || !track.name.trim()) {
    throw badResponse(`${context} track id and name must be non-empty`);
  }
  if (!String(track.url_id).trim() || !String(track.lyric_id).trim()) {
    throw badResponse(`${context} track url_id and lyric_id must be non-empty`);
  }
  return track;
};

export const validateAIRecommendationTracks = (
  value: unknown,
  context: string,
): GdStudioTrack[] => {
  if (!Array.isArray(value)) throw badResponse(`${context} response must be an array`);
  const tracks: GdStudioTrack[] = [];
  const seen = new Set<string>();
  for (const valueTrack of value) {
    const track = validateTrack(valueTrack, context);
    const source = normalizeGDStudioSource(track.source) as GdStudioSource;
    const key = getTrackKey(String(track.id).trim(), source);
    if (seen.has(key)) continue;
    seen.add(key);
    tracks.push(track);
  }
  return tracks;
};

const parsePollinationsRecommendations = (text: string): PollinationsRecommendation[] => {
  let response: unknown;
  try {
    response = JSON.parse(text);
  } catch {
    throw badResponse('Pollinations response must be valid JSON');
  }
  let recommendations: unknown = response;
  if (!Array.isArray(response)) {
    if (!response || typeof response !== 'object') {
      throw badResponse('Pollinations response is missing content');
    }
    const objectResponse = response as {
      content?: unknown;
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = typeof objectResponse.content === 'string'
      ? objectResponse.content
      : objectResponse.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw badResponse('Pollinations response is missing content');
    try {
      recommendations = JSON.parse(content);
    } catch {
      throw badResponse('Pollinations content must be a JSON array');
    }
  }
  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    throw badResponse('Pollinations recommendations must be a non-empty array');
  }
  return recommendations.slice(0, POLLINATIONS_RECOMMENDATION_LIMIT).map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw badResponse('Pollinations recommendation must be an object');
    }
    const { name, artist } = item as { name?: unknown; artist?: unknown };
    if (typeof name !== 'string' || !name.trim() || typeof artist !== 'string' || !artist.trim()) {
      throw badResponse('Pollinations recommendation requires name and artist');
    }
    return { name: name.trim(), artist: artist.trim() };
  });
};

const searchRecommendedTracks = async (
  recommendations: PollinationsRecommendation[],
  source: GdStudioSource,
  signal?: AbortSignal,
): Promise<GdStudioTrack[]> => {
  const settled = await Promise.allSettled(recommendations.map(async (recommendation) => {
    const { name, artist } = recommendation;
    const data = await fetchGDStudioData<unknown>({
      types: 'search', count: 1, source, pages: 1, name: `${name} ${artist}`,
    }, signal);
    const tracks = validateAIRecommendationTracks(data, 'Pollinations search');
    if (tracks.length === 0) throw badResponse(`recommended song was not found: ${name} - ${artist}`);
    if (normalizeGDStudioSource(tracks[0].source) !== source) {
      throw badResponse(`recommended song source mismatch: ${name} - ${artist}`);
    }
    if (!isRecommendedTrackMatch(tracks[0], recommendation)) {
      throw badResponse(`recommended song identity mismatch: ${name} - ${artist}`);
    }
    return tracks[0];
  }));
  const tracks = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  if (tracks.length === 0) {
    const rejected = settled.flatMap((result) => result.status === 'rejected'
      ? [result.reason] : []);
    const classified = rejected.find((error) => error instanceof GDStudioApiError
      && error.code === 'RATE_LIMIT')
      || rejected.find((error) => error instanceof GDStudioApiError
        && error.code === 'UNAVAILABLE');
    if (classified instanceof GDStudioApiError) throw classified;
    const failures = rejected.map(String);
    throw badResponse(`Pollinations recommendations could not be resolved: ${failures.join('; ')}`);
  }
  return tracks;
};

const fetchPollinationsRecommendations = async (
  keyword: string,
  source: GdStudioSource,
  signal?: AbortSignal,
): Promise<GdStudioTrack[]> => {
  const prompt = `[No reasoning] 严格禁止任何思考链。请根据意境“${keyword}”，推荐4首适合的中文歌曲。以极简的纯JSON数组格式返回：[{"name":"歌名","artist":"歌手"}]。绝对不要有任何解释、推理思考、Markdown格式标记或多余字眼！`;
  let response: Response;
  try {
    response = await fetchWithTimeout(POLLINATIONS_OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai-fast',
        temperature: 0.4,
        max_tokens: 2_000,
        reasoning_effort: 'low',
        messages: [
          { role: 'system', content: '只推荐真实存在且歌手准确的歌曲，只输出严格 JSON 数组，不要 Markdown 或额外文字。' },
          { role: 'user', content: prompt },
        ],
      }),
      signal,
    }, POLLINATIONS_TIMEOUT_MS);
  } catch (error) {
    throwIfAborted(signal);
    throw new GDStudioApiError('UNAVAILABLE', 0, `Pollinations request failed: ${String(error)}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new GDStudioApiError('UNAVAILABLE', response.status, text.slice(0, 500));
  }
  return searchRecommendedTracks(parsePollinationsRecommendations(text), source, signal);
};

export const loadAIRecommendationTracks = async (
  keyword: string,
  source: GdStudioSource,
  count: number,
  signal?: AbortSignal,
): Promise<GdStudioTrack[]> => {
  throwIfAborted(signal);
  let officialFailure: unknown;
  try {
    const official = validateAIRecommendationTracks(await fetchGDStudioData<unknown>({
      types: 'embeat_agent', count, source, pages: 1, name: keyword,
    }, signal), 'embeat_agent');
    if (official.length > 0) return official;
    officialFailure = badResponse('embeat_agent returned no recommendations');
  } catch (error) {
    throwIfAborted(signal);
    officialFailure = error;
  }
  try {
    return await fetchPollinationsRecommendations(keyword, source, signal);
  } catch (fallbackFailure) {
    const fallbackError = fallbackFailure instanceof GDStudioApiError ? fallbackFailure : null;
    throw new GDStudioApiError(
      fallbackError?.code || 'UNAVAILABLE',
      fallbackError?.status || 0,
      `embeat_agent failed: ${String(officialFailure)}; Pollinations failed: ${String(fallbackFailure)}`,
    );
  }
};

const resolveItemSource = (item: GdStudioTrack): GdStudioSource => {
  const source = normalizeGDStudioSource(item.source);
  if (!source) throw badResponse('recommendation track source is invalid');
  return source;
};

export const enrichAIRecommendationCovers = async (
  tracks: GdStudioTrack[],
  resolveCover: CoverResolver,
): Promise<void> => {
  await Promise.all(tracks.map(async (item) => {
    const track = validateTrack(item, 'recommendation');
    const picId = String(track.pic_id).trim();
    const songId = String(track.id).trim();
    if (!picId || picId.startsWith('http') || picId.startsWith('//')) return;
    const cover = await resolveCover(resolveItemSource(track), picId, 500, songId);
    if (cover) track.pic_id = cover;
  }));
};

export const mapAIRecommendationTracks = (tracks: GdStudioTrack[]): Song[] => {
  const songs: Song[] = [];
  const seen = new Set<string>();
  for (const value of tracks) {
    const item = validateTrack(value, 'recommendation');
    const id = String(item.id).trim();
    const source = resolveItemSource(item);
    const key = getTrackKey(id, source);
    if (seen.has(key)) continue;
    seen.add(key);
    const picId = String(item.pic_id).trim();
    const lyricId = String(item.lyric_id).trim();
    const urlId = String(item.url_id).trim();
    const pic = picId.startsWith('http') || picId.startsWith('//') ? fixUrl(picId) : '';
    rememberTrackMeta(id, source, { pic, picId, lyricId, urlId });
    songs.push({
      id,
      name: String(item.name).trim(),
      artist: joinArtists(item.artist),
      album: String(item.album),
      pic,
      picId,
      lyricId,
      urlId,
      source,
    });
  }
  return songs;
};
