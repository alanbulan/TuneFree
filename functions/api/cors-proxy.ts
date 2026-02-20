/**
 * Cloudflare Pages Function — CORS 代理
 * 路由：/api/cors-proxy?url=<encoded_url>
 *
 * 替代外部 CORS 代理（corsproxy.io 等），国内可直接访问。
 * 支持 GET/POST/PUT/DELETE，透传请求体和 Content-Type。
 */

// 允许的目标域名白名单（防止被滥用为开放代理）
const ALLOWED_HOSTS = [
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
    'kwcdn.kuwo.cn',
    'mobi.kuwo.cn',
    'nmobi.kuwo.cn',
    'musicpay.kuwo.cn',
    'm.kuwo.cn',
];

export const onRequest: PagesFunction = async (context) => {
    const { request } = context;

    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: corsHeaders(request),
        });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
        return jsonResponse({ error: 'Missing ?url= parameter' }, 400, request);
    }

    let parsedTarget: URL;
    try {
        parsedTarget = new URL(targetUrl);
    } catch {
        return jsonResponse({ error: 'Invalid target URL' }, 400, request);
    }

    // 白名单检查
    if (!ALLOWED_HOSTS.some(host => parsedTarget.hostname === host || parsedTarget.hostname.endsWith('.' + host))) {
        return jsonResponse({ error: `Host not allowed: ${parsedTarget.hostname}` }, 403, request);
    }

    try {
        // 构建转发请求
        const headers = new Headers();
        // 透传 Content-Type
        const ct = request.headers.get('Content-Type');
        if (ct) headers.set('Content-Type', ct);
        // 某些 API 需要 User-Agent
        headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        // 某些 API 需要 Referer
        headers.set('Referer', parsedTarget.origin);

        const fetchOpts: RequestInit = {
            method: request.method,
            headers,
            redirect: 'follow',
        };

        // 转发请求体（POST/PUT）
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            fetchOpts.body = await request.arrayBuffer();
        }

        const resp = await fetch(targetUrl, fetchOpts);

        // 构建响应，附加 CORS 头
        const respHeaders = new Headers(resp.headers);
        for (const [k, v] of Object.entries(corsHeaders(request))) {
            respHeaders.set(k, v);
        }
        // 移除可能导致解码问题的头
        respHeaders.delete('content-encoding');

        return new Response(resp.body, {
            status: resp.status,
            headers: respHeaders,
        });
    } catch (e: any) {
        return jsonResponse({ error: e.message || 'Proxy fetch failed' }, 502, request);
    }
};

function corsHeaders(request: Request): Record<string, string> {
    return {
        'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
    };
}

function jsonResponse(data: any, status: number, request: Request) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(request),
        },
    });
}
