import { createHash } from 'node:crypto';

const API_URL = 'https://music-api.gdstudio.xyz/api.php';
const TIME_URL = 'https://music-api.gdstudio.xyz/time';
const SOURCES = [
  'netease', 'tencent', 'kuwo', 'tidal', 'qobuz',
  'joox', 'bilibili', 'apple', 'ytmusic', 'spotify',
];
const REQUIRED_TRACK_FIELDS = [
  'id', 'name', 'artist', 'album', 'pic_id', 'url_id', 'lyric_id', 'source',
];
const sourceArgumentIndex = process.argv.indexOf('--source');
const requestedSources = sourceArgumentIndex >= 0 && process.argv[sourceArgumentIndex + 1]
  ? [process.argv[sourceArgumentIndex + 1]]
  : SOURCES;
const verifyDetails = process.argv.includes('--details');

const encodeSubject = (value) => encodeURIComponent(value)
  .replace(/'/g, '%27')
  .replace(/\(/g, '%28')
  .replace(/\)/g, '%29');

const readServerOffset = async () => {
  const startedAt = Date.now();
  const response = await fetch(TIME_URL);
  if (!response.ok) throw new Error(`time endpoint returned HTTP ${response.status}`);
  const serverTime = Number((await response.text()).trim());
  if (!Number.isFinite(serverTime) || serverTime <= 0) throw new Error('invalid server time');
  return serverTime * 1000 - (startedAt + (Date.now() - startedAt) / 2);
};

const requestApi = async (params, serverOffset) => {
  const subject = encodeSubject(String(params.name ?? params.id ?? params.types ?? ''));
  const timestamp = String(Date.now() + serverOffset).slice(0, 9);
  const signature = createHash('md5')
    .update(`${timestamp}|music.gdstudio.org|20260616|${subject}`)
    .digest('hex')
    .slice(-8)
    .toUpperCase();
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    body.set(key, String(value));
  }
  body.set('s', signature);
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body,
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // Report invalid JSON with the original response excerpt below.
  }
  return { status: response.status, data, excerpt: text.slice(0, 180) };
};

const validateTrack = (track) => {
  if (!track || typeof track !== 'object' || Array.isArray(track)) return ['track is not an object'];
  const issues = REQUIRED_TRACK_FIELDS
    .filter((field) => !(field in track))
    .map((field) => `missing ${field}`);
  const artistIsValid = typeof track.artist === 'string'
    || (Array.isArray(track.artist) && track.artist.every((artist) => typeof artist === 'string'));
  if (!artistIsValid) issues.push('artist has invalid type');
  for (const field of ['album', 'pic_id', 'source']) {
    if (typeof track[field] !== 'string') issues.push(`${field} has invalid type`);
  }
  for (const field of ['id', 'name', 'url_id', 'lyric_id', 'source']) {
    if (!String(track[field] ?? '').trim()) issues.push(`${field} is empty`);
  }
  return issues;
};

const verifySourceSearch = async (source, serverOffset) => {
  try {
    const response = await requestApi({
      types: 'search', source, name: '周杰伦', count: 2, pages: 1,
    }, serverOffset);
    const tracks = Array.isArray(response.data) ? response.data : [];
    const issues = tracks.flatMap(validateTrack);
    const keys = tracks.map((track) => `${track.source}:${track.id}`);
    const responseSourceMatches = tracks.every((track) => track.source === source);
    const valid = response.status >= 200
      && response.status < 300
      && Array.isArray(response.data)
      && tracks.length > 0
      && issues.length === 0
      && new Set(keys).size === keys.length
      && responseSourceMatches;
    return {
      source,
      valid,
      status: response.status,
      responseType: Array.isArray(response.data) ? 'array' : typeof response.data,
      count: tracks.length,
      uniqueCount: new Set(keys).size,
      firstSource: tracks[0]?.source ?? null,
      issues: [...new Set(issues)],
      responseSourceMatches,
      firstTrack: tracks[0] ?? null,
      error: response.data?.error ?? response.data?.detail
        ?? (response.status >= 400 ? response.excerpt : null),
    };
  } catch (error) {
    return { source, status: 0, responseType: 'request-error', count: 0, error: String(error) };
  }
};

const verifyTrackDetails = async (track, serverOffset) => {
  const requests = {
    url: { types: 'url', source: track.source, id: track.url_id, br: 320 },
    pic: { types: 'pic', source: track.source, id: track.pic_id, size: 300 },
    lyric: { types: 'lyric', source: track.source, id: track.lyric_id },
  };
  const details = {};
  for (const [name, params] of Object.entries(requests)) {
    const response = await requestApi(params, serverOffset);
    details[name] = {
      valid: response.status >= 200
        && response.status < 300
        && response.data
        && typeof response.data === 'object'
        && typeof response.data.url === 'string'
        && response.data.url.trim().length > 0,
      status: response.status,
      responseType: Array.isArray(response.data) ? 'array' : typeof response.data,
      fields: response.data && typeof response.data === 'object'
        ? Object.keys(response.data)
        : [],
      data: response.data,
      error: response.data?.error ?? response.data?.detail
        ?? (response.status >= 400 ? response.excerpt : null),
    };
  }
  details.lyric.valid = details.lyric.status >= 200
    && details.lyric.status < 300
    && details.lyric.data
    && typeof details.lyric.data === 'object'
    && typeof details.lyric.data.lyric === 'string';
  return details;
};

const main = async () => {
  const serverOffset = await readServerOffset();
  const results = [];
  for (const source of requestedSources) {
    const result = await verifySourceSearch(source, serverOffset);
    if (verifyDetails && result.firstTrack) {
      result.details = await verifyTrackDetails(result.firstTrack, serverOffset);
    }
    results.push(result);
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
  const failed = results.some((result) => !result.valid
    || (verifyDetails && result.details
      && Object.values(result.details).some((detail) => !detail.valid)));
  if (failed) process.exitCode = 1;
};

await main();
