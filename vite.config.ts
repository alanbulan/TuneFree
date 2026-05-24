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

const readRequestBody = async (req: any) => {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
};

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
        const responseContentType = upstream.headers.get('content-type');
        if (responseContentType) res.setHeader('Content-Type', responseContentType);
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
  plugins: [react(), localCorsProxyPlugin()],
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
