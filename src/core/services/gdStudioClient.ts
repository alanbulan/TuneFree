import { GD_STUDIO_API_BASE } from './config';
import { toGDStudioApiSource } from './gdStudioModel';
import { createLinkedAbort, proxyFetch, throwIfAborted } from './proxy';
import { bindResponseLifetime } from './responseLifetime';

const GD_STUDIO_REQUEST_TIMEOUT_MS = 12_000;
const TIME_SYNC_TIMEOUT_MS = 5_000;

let lastTimeDiff = 0;
let timeSynced = false;

export class GDStudioApiError extends Error {
  constructor(
    public readonly code: 'RATE_LIMIT' | 'UNSUPPORTED_SOURCE' | 'UNAVAILABLE' | 'BAD_RESPONSE',
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`GD_STUDIO_${code}: ${detail}`);
    this.name = 'GDStudioApiError';
  }
}

const countDecodeArtifacts = (text: string): number => (text.match(/�/g) || []).length;

export const decodeResponseText = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  try {
    const gb18030 = new TextDecoder('gb18030').decode(bytes);
    return countDecodeArtifacts(gb18030) < countDecodeArtifacts(utf8) ? gb18030 : utf8;
  } catch {
    return utf8;
  }
};

export const tryParseJson = (text: string): any | null => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const looksLikeRateLimitResponse = (status: number, text: string): boolean => {
  if (status === 429) return true;
  if (status === 403 && /__cf_chl_|Just a moment|cf-browser-verification/i.test(text)) return true;
  return /频率|rate limit|too many requests/i.test(text);
};

export const classifyGDStudioFailure = (
  status: number,
  text: string,
): GDStudioApiError['code'] => {
  if (/source.+not supported/i.test(text)) return 'UNSUPPORTED_SOURCE';
  if (looksLikeRateLimitResponse(status, text)) return 'RATE_LIMIT';
  return status >= 400 ? 'UNAVAILABLE' : 'BAD_RESPONSE';
};

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const linked = createLinkedAbort(init.signal ?? undefined, timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: linked.signal });
    return bindResponseLifetime(response, linked);
  } catch (error) {
    linked.cleanup();
    throw error;
  }
}

export async function syncServerTime(signal?: AbortSignal): Promise<void> {
  const start = Date.now();
  const response = await fetchWithTimeout(
    'https://music-api.gdstudio.xyz/time',
    { method: 'GET', signal },
    TIME_SYNC_TIMEOUT_MS,
  );
  const text = (await response.text()).trim();
  if (!response.ok) {
    throw new GDStudioApiError(
      classifyGDStudioFailure(response.status, text),
      response.status,
      text.slice(0, 500),
    );
  }
  const serverTime = Number(text);
  if (!Number.isFinite(serverTime) || serverTime <= 0) {
    throw new GDStudioApiError('BAD_RESPONSE', response.status, 'invalid server time');
  }
  const latency = (Date.now() - start) / 2;
  lastTimeDiff = serverTime * 1000 - (start + latency);
  timeSynced = true;
}

const gdUrlEncode = (value: string): string =>
  encodeURIComponent(value).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');

export const calculateMD5 = async (value: string): Promise<string> => {
  const constants: number[] = [];
  let index = 0;
  for (; index < 64;) constants[index] = Math.abs(Math.sin(++index)) * 4294967296 | 0;
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  const utf8 = unescape(encodeURIComponent(value));
  const length = utf8.length;
  const blocks = Array.from({ length: ((length + 8 >> 6) + 1) * 16 }, () => 0);
  let blockIndex = 0;
  for (; blockIndex < length; blockIndex++) {
    blocks[blockIndex >> 2] |= utf8.charCodeAt(blockIndex) << ((blockIndex % 4) << 3);
  }
  blocks[blockIndex >> 2] |= 0x80 << ((blockIndex % 4) << 3);
  blocks[blocks.length > 2 ? blocks.length - 2 : 0] = length * 8;
  for (blockIndex = 0; blockIndex < blocks.length; blockIndex += 16) {
    const [oldA, oldB, oldC, oldD] = [a, b, c, d];
    for (index = 0; index < 64; index++) {
      let f = 0;
      let g = 0;
      if (index < 16) [f, g] = [(b & c) | (~b & d), index];
      else if (index < 32) [f, g] = [(d & b) | (~d & c), (5 * index + 1) % 16];
      else if (index < 48) [f, g] = [b ^ c ^ d, (3 * index + 5) % 16];
      else [f, g] = [c ^ (b | ~d), (7 * index) % 16];
      const previousD = d;
      d = c;
      c = b;
      const sum = a + f + constants[index] + (blocks[blockIndex + g] || 0);
      const shift = shifts[(index >> 4 << 2) + index % 4];
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
      a = previousD;
    }
    a = (a + oldA) | 0;
    b = (b + oldB) | 0;
    c = (c + oldC) | 0;
    d = (d + oldD) | 0;
  }
  const wordToHex = (word: number): string => {
    let hex = '';
    for (let offset = 0; offset < 4; offset++) {
      hex += ((word >> (offset << 3)) & 0xff).toString(16).padStart(2, '0');
    }
    return hex;
  };
  return wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
};

export const buildGDStudioRequestBody = async (
  params: Record<string, string | number>,
  timestampMs: number,
): Promise<URLSearchParams> => {
  const tsPrefix = String(timestampMs).slice(0, 9);
  const subject = params.name !== undefined
    ? gdUrlEncode(String(params.name))
    : gdUrlEncode(String(params.id ?? params.types ?? ''));
  const hash = await calculateMD5(`${tsPrefix}|music.gdstudio.org|20260616|${subject}`);
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 's') continue;
    body.set(key, key === 'source' ? toGDStudioApiSource(String(value)) : String(value));
  }
  body.set('s', params.s ? String(params.s) : hash.slice(-8).toUpperCase());
  return body;
};

export const fetchGDStudioData = async <T = any>(
  params: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<T> => {
  if (!timeSynced) {
    try {
      await syncServerTime(signal);
    } catch (error) {
      throwIfAborted(signal);
      if (error instanceof GDStudioApiError) throw error;
      throw new GDStudioApiError('UNAVAILABLE', 0, String(error));
    }
  }
  const body = await buildGDStudioRequestBody(params, Date.now() + lastTimeDiff);
  let response: Response | null;
  try {
    response = await proxyFetch(GD_STUDIO_API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.toString(),
      signal,
    }, GD_STUDIO_REQUEST_TIMEOUT_MS);
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof GDStudioApiError) throw error;
    throw new GDStudioApiError('UNAVAILABLE', 0, String(error));
  }
  if (!response) throw new GDStudioApiError('UNAVAILABLE', 0, 'empty proxy response');
  const text = decodeResponseText(await response.arrayBuffer());
  const data = tryParseJson(text);
  if (!response.ok || typeof data?.error === 'string' || typeof data?.detail === 'string') {
    const errorText = typeof data?.error === 'string'
      ? data.error
      : typeof data?.detail === 'string' ? data.detail : text;
    throw new GDStudioApiError(
      classifyGDStudioFailure(response.status, errorText),
      response.status,
      errorText.slice(0, 500),
    );
  }
  if (!data) {
    throw new GDStudioApiError(
      classifyGDStudioFailure(response.status, text),
      response.status,
      text.slice(0, 500),
    );
  }
  return data as T;
};
