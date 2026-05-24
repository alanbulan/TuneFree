import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ALLOWED_PROXY_HOSTS = [
  'music.163.com',
  'interface.music.163.com',
  'interface3.music.163.com',
  'u.y.qq.com',
  'c.y.qq.com',
  'shc.y.qq.com',
  'y.gtimg.cn',
  'search.kuwo.cn',
  'www.kuwo.cn',
  'kuwo.cn',
  'artistpicserver.kuwo.cn',
  'kbangserver.kuwo.cn',
  'antiserver.kuwo.cn',
  'kwcdn.kuwo.cn',
  'sycdn.kuwo.cn',
  'mobi.kuwo.cn',
  'nmobi.kuwo.cn',
  'musicpay.kuwo.cn',
  'm.kuwo.cn',
  'music-api.gdstudio.xyz',
  'hdslb.com',
  'biliimg.com',
];

const isAllowedProxyHost = (hostname: string) =>
  ALLOWED_PROXY_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );

const isBilibiliImageHost = (hostname: string) =>
  hostname === 'hdslb.com' ||
  hostname.endsWith('.hdslb.com') ||
  hostname === 'biliimg.com' ||
  hostname.endsWith('.biliimg.com');

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const readRequestBody = async (req: any): Promise<ArrayBuffer | undefined> => {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? encoder.encode(chunk) : new Uint8Array(chunk));
  }

  if (chunks.length === 0) return undefined;
  if (chunks.length === 1) return toArrayBuffer(chunks[0]);

  const body = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body.buffer;
};

const sendJson = (res: any, statusCode: number, data: unknown) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
];

const getRandomUserAgent = () =>
  USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const getLocalKuwoQualityCandidates = (quality: string): string[] => {
  if (quality === 'flac' || quality === 'ape') {
    return ['2000kflac', '320kmp3', '192kmp3', '128kmp3', '48kaac'];
  }
  if (quality === '320k') return ['320kmp3', '192kmp3', '128kmp3', '48kaac'];
  if (quality === '192k') return ['192kmp3', '128kmp3', '48kaac'];
  return ['128kmp3', '48kaac'];
};

const getLocalKuwoMobiUrl = async (
  id: string,
  quality: string,
): Promise<string | null> => {
  let fallbackUrl: string | null = null;

  for (const br of getLocalKuwoQualityCandidates(quality)) {
    try {
      const apiUrl = `http://mobi.kuwo.cn/mobi.s?f=web&type=convert_url_with_sign&source=jiakong&rid=${encodeURIComponent(id)}&br=${br}`;
      const resp = await fetch(apiUrl, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          Referer: 'http://kuwo.cn/',
        },
      });

      const data = await resp.json();
      const playUrl = data?.data?.url;
      const format = String(data?.data?.format || '').toLowerCase();
      if (!playUrl || !playUrl.startsWith('http')) continue;

      fallbackUrl ||= playUrl;
      if (format === 'mp3' || format === 'flac') return playUrl;
    } catch {
      // try next bitrate
    }
  }

  return fallbackUrl;
};

const getLocalKuwoUrl = async (id: string, quality: string): Promise<string> => {
  const playUrl = await getLocalKuwoMobiUrl(id, quality);

  if (!playUrl) {
    throw new Error('Kuwo returned empty URL');
  }

  return `/api/cors-proxy?url=${encodeURIComponent(playUrl)}`;
};

const localNativeUrlPlugin = () => ({
  name: 'local-native-url',
  configureServer(server: any) {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      const requestUrl = new URL(req.url || '/', 'http://localhost');
      if (requestUrl.pathname !== '/api/url') {
        next();
        return;
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const platform = requestUrl.searchParams.get('platform');
      const id = requestUrl.searchParams.get('id');
      const quality = requestUrl.searchParams.get('quality') || '128k';

      if (!platform || !id) {
        sendJson(res, 400, { error: 'Missing platform or id' });
        return;
      }

      try {
        if (platform !== 'kuwo') {
          sendJson(res, 400, { error: `Platform ${platform} not supported locally` });
          return;
        }

        sendJson(res, 200, { url: await getLocalKuwoUrl(id, quality) });
      } catch (error: any) {
        sendJson(res, 500, { error: error?.message || 'Failed to fetch url' });
      }
    });
  },
});

const localCorsProxyPlugin = () => ({
  name: 'local-cors-proxy',
  configureServer(server: any) {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      const requestUrl = new URL(req.url || '/', 'http://localhost');
      if (requestUrl.pathname !== '/api/cors-proxy') {
        next();
        return;
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const targetUrl = requestUrl.searchParams.get('url');
      if (!targetUrl) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
        return;
      }

      let parsedTarget: URL;
      try {
        parsedTarget = new URL(targetUrl);
      } catch {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid target URL' }));
        return;
      }

      if (!isAllowedProxyHost(parsedTarget.hostname)) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: `Host not allowed: ${parsedTarget.hostname}` }));
        return;
      }

      try {
        const headers = new Headers();
        const contentType = req.headers['content-type'];
        const range = req.headers.range;
        if (typeof contentType === 'string') headers.set('Content-Type', contentType);
        if (typeof range === 'string') headers.set('Range', range);
        headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36');
        headers.set('Referer', parsedTarget.origin);

        if (parsedTarget.hostname === 'music-api.gdstudio.xyz') {
          headers.set('Accept', 'application/json,text/plain,*/*');
          headers.set('Referer', 'https://music.gdstudio.xyz/');
        }

        if (isBilibiliImageHost(parsedTarget.hostname)) {
          headers.set('Referer', 'https://www.bilibili.com/');
        }

        const upstream = await fetch(targetUrl, {
          method: req.method,
          headers,
          body: await readRequestBody(req),
          redirect: 'follow',
        });
        for (const headerName of [
          'content-type',
          'content-length',
          'content-range',
          'accept-ranges',
          'cache-control',
        ]) {
          const value = upstream.headers.get(headerName);
          if (value) res.setHeader(headerName, value);
        }
        res.statusCode = upstream.status;
        res.end(new Uint8Array(await upstream.arrayBuffer()));
      } catch (error: any) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: error?.message || 'Proxy fetch failed' }));
      }
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), localNativeUrlPlugin(), localCorsProxyPlugin()],
  optimizeDeps: {
    entries: ['index.html'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  base: './',
  server: {
    port: 3000
  }
});
