import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * Cloudflare Pages Function — 原生音源播放地址解析
 * 路由：/api/url?platform=<netease|qq|kuwo>&id=<songId>&quality=<128k|320k|flac|flac24bit>
 *
 * 协议与桌面端 Rust provider（src-tauri/src/api/{netease,qq,kuwo}.rs）保持一致：
 * - netease: EAPI AES-128-ECB 加密请求
 * - qq:      musicu.fcg CgiGetVkey，filename 必须是 "M500<mid><mid>.mp3" 形式
 * - kuwo:    mobi.s?f=web&type=convert_url_with_sign 明文接口，响应为 JSON；
 *            旧的 f=kuwo 块加密端点已被上游 nginx 无条件 403，仅作兜底保留。
 *            注意：酷我对非大陆出口 IP 返回 code=407 地区版权封锁，Cloudflare
 *            的出口 IP 一律命中，故本函数内的原生酷我解析实际无法成功，
 *            线上依赖 GD Studio 解析（其解析结果可正常播放，因为酷我音频
 *            CDN 不做地区封锁）。详见 parseKuwoResponse 的注释。
 *
 * 响应约定（客户端只关心 url 是否存在）：
 *   200 { url: "https://..." }                解析成功
 *   200 { url: null, reason: "vip" }          歌曲为 VIP / 版权受限
 *   200 { url: null, reason: "unavailable" }  上游没有可用地址
 *   400 { error }                             参数缺失或平台不支持
 *   502 { error }                             请求上游失败
 */

// Types
interface Env {}

/** 单个音源的解析结果：要么给出地址，要么说明为什么没有。 */
type ResolveResult =
  | { url: string }
  | { url: null; reason: "vip" | "unavailable" | "region" };

/** 只接受 http(s) 绝对地址，避免把 file:// 之类的值交给媒体元素。 */
const isPlayableUrl = (value: unknown): value is string => {
    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    try {
        const parsed = new URL(trimmed);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
};

export const onRequest: any = async (context: any) => {
    const { request } = context;
    const url = new URL(request.url);
    const platform = url.searchParams.get('platform');
    const id = url.searchParams.get('id');
    const quality = url.searchParams.get('quality') || '128k';

    if (!platform || !id) {
        return new Response(JSON.stringify({ error: 'Missing platform or id' }), {
            status: 400,
            headers: corsHeaders()
        });
    }

    try {
        let result: ResolveResult | null = null;

        if (platform === 'netease') {
            result = await getNeteaseUrl(id, quality);
        } else if (platform === 'qq' || platform === 'tencent') {
            result = await getQQUrl(id, quality);
        } else if (platform === 'kuwo') {
            result = await getKuwoUrl(id, quality);
        } else {
            return new Response(JSON.stringify({ error: `Platform ${platform} not supported natively` }), {
                status: 400,
                headers: corsHeaders()
            });
        }

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: corsHeaders()
        });
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message || 'Failed to fetch url' }), {
            status: 502,
            headers: corsHeaders()
        });
    }
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json'
    };
}

const md5Hex = (text: string) => crypto.createHash('md5').update(text).digest('hex');

const aesEncryptHex = (text: string, key: string, iv: string, mode: string) => {
    const cipher = crypto.createCipheriv(mode, Buffer.from(key), iv ? Buffer.from(iv) : '');
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
};

const USER_AGENTS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1", 
    "Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36", 
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:46.0) Gecko/20100101 Firefox/46.0", 
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36"
];
const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

async function getNeteaseUrl(songmid: string, quality: string): Promise<ResolveResult> {
    // 码率表与 Rust get_netease_url 一致：未知音质按 128k 处理。
    const qualityMap: Record<string, number> = { "128k": 128000, "320k": 320000, "flac": 999000 };
    const bitrate = qualityMap[quality] || 128000;

    const apiUrl = "https://interface3.music.163.com/eapi/song/enhance/player/url";
    const reqPath = "/api/song/enhance/player/url";

    const payloadStr = JSON.stringify({ ids: `[${songmid}]`, br: bitrate });
    const hashStr = `nobody${reqPath}use${payloadStr}md5forencrypt`;
    const md5Hash = md5Hex(hashStr);
    const encryptTarget = `${reqPath}-36cd479b6b5-${payloadStr}-36cd479b6b5-${md5Hash}`;
    const aesKey = "e82ckenh8dichen8";

    const formParams = {
        params: aesEncryptHex(encryptTarget, aesKey, '', "aes-128-ecb").toUpperCase()
    };

    const resp = await fetch(apiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": "os=pc;"
        },
        body: new URLSearchParams(formParams).toString()
    });

    if (!resp.ok) throw new Error(`Netease responded HTTP ${resp.status}`);

    const data: any = await resp.json();
    const playUrl = data?.data?.[0]?.url;
    // 网易云对 VIP / 版权受限歌曲返回空地址，属于正常结果而非错误。
    if (!isPlayableUrl(playUrl)) return { url: null, reason: "vip" };
    return { url: playUrl.trim() };
}

// ==============================
// QQ 音乐
// ==============================

const QQ_MUSICU_ENDPOINT = "https://u.y.qq.com/cgi-bin/musicu.fcg";
/** vkey 响应缺少 sip 时的兜底流媒体主机。 */
const QQ_DEFAULT_STREAM_BASE = "https://ws.stream.qqmusic.qq.com/";

/**
 * vkey 请求的文件名必须把 songmid 重复两遍（M800<mid><mid>.mp3），
 * 只写位速率前缀会拿到空的 purl，这是线上 500 的直接原因。
 */
const buildQQFilename = (songmid: string, quality: string): string => {
    const [prefix, extension] =
        quality === "320k" ? ["M800", "mp3"]
        : quality === "flac" || quality === "flac24bit" ? ["F000", "flac"]
        : ["M500", "mp3"];
    return `${prefix}${songmid}${songmid}.${extension}`;
};

/** purl 可能是绝对地址，也可能是相对路径，需要按 sip 主机补全。 */
const resolveQQPurl = (data: any): string | null => {
    const vkeyData = data?.queryvkey?.data;
    const rawPurl = vkeyData?.midurlinfo?.[0]?.purl;
    const purl = typeof rawPurl === "string" ? rawPurl.trim() : "";
    if (!purl) return null;
    if (isPlayableUrl(purl)) return purl;

    const sip = Array.isArray(vkeyData?.sip)
        ? vkeyData.sip.find((value: unknown) => typeof value === "string" && value.trim())
        : undefined;

    try {
        const resolved = new URL(purl, sip || QQ_DEFAULT_STREAM_BASE);
        return isPlayableUrl(resolved.toString()) ? resolved.toString() : null;
    } catch {
        return null;
    }
};

async function getQQUrl(songmid: string, quality: string): Promise<ResolveResult> {
    const dataParam = JSON.stringify({
        queryvkey: {
            method: "CgiGetVkey",
            module: "vkey.GetVkeyServer",
            param: {
                checklimit: 0,
                ctx: 1,
                downloadfrom: 0,
                uin: "0",
                filename: [buildQQFilename(songmid, quality)],
                guid: "0",
                songmid: [songmid]
            }
        }
    });

    const resp = await fetch(`${QQ_MUSICU_ENDPOINT}?data=${encodeURIComponent(dataParam)}`, {
        method: "GET",
        headers: {
            'User-Agent': getRandomUserAgent(),
            'origin': "https://y.qq.com",
            'referer': "https://y.qq.com/portal/search.html"
        }
    });

    if (!resp.ok) throw new Error(`QQ Music responded HTTP ${resp.status}`);

    const data: any = await resp.json();
    const purl = resolveQQPurl(data);
    // 空 purl 表示 VIP / 版权受限。
    if (!purl) return { url: null, reason: "vip" };
    return { url: purl };
}

const kuwoCryptoAlgorithm = (function() {
    const C0 = [0x1fn, 0x0n, 0x1n, 0x2n, 0x3n, 0x4n, -0x1n, -0x1n, 0x3n, 0x4n, 0x5n, 0x6n, 0x7n, 0x8n, -0x1n, -0x1n, 0x7n, 0x8n, 0x9n, 0xan, 0xbn, 0xcn, -0x1n, -0x1n, 0xbn, 0xcn, 0xdn, 0xen, 0xfn, 0x10n, -0x1n, -0x1n, 0xfn, 0x10n, 0x11n, 0x12n, 0x13n, 0x14n, -0x1n, -0x1n, 0x13n, 0x14n, 0x15n, 0x16n, 0x17n, 0x18n, -0x1n, -0x1n, 0x17n, 0x18n, 0x19n, 0x1an, 0x1bn, 0x1cn, -0x1n, -0x1n, 0x1bn, 0x1cn, 0x1dn, 0x1en, 0x1fn, 0x1en, -0x1n, -0x1n];
    const C1 = [0x39n, 0x31n, 0x29n, 0x21n, 0x19n, 0x11n, 0x9n, 0x1n, 0x3bn, 0x33n, 0x2bn, 0x23n, 0x1bn, 0x13n, 0xbn, 0x3n, 0x3dn, 0x35n, 0x2dn, 0x25n, 0x1dn, 0x15n, 0xdn, 0x5n, 0x3fn, 0x37n, 0x2fn, 0x27n, 0x1fn, 0x17n, 0xfn, 0x7n, 0x38n, 0x30n, 0x28n, 0x20n, 0x18n, 0x10n, 0x8n, 0x0n, 0x3an, 0x32n, 0x2an, 0x22n, 0x1an, 0x12n, 0xan, 0x2n, 0x3cn, 0x34n, 0x2cn, 0x24n, 0x1cn, 0x14n, 0xcn, 0x4n, 0x3en, 0x36n, 0x2en, 0x26n, 0x1en, 0x16n, 0xen, 0x6n];
    const C2 = [0x27n, 0x7n, 0x2fn, 0xfn, 0x37n, 0x17n, 0x3fn, 0x1fn, 0x26n, 0x6n, 0x2en, 0xen, 0x36n, 0x16n, 0x3en, 0x1en, 0x25n, 0x5n, 0x2dn, 0xdn, 0x35n, 0x15n, 0x3dn, 0x1dn, 0x24n, 0x4n, 0x2cn, 0xcn, 0x34n, 0x14n, 0x3cn, 0x1cn, 0x23n, 0x3n, 0x2bn, 0xbn, 0x33n, 0x13n, 0x3bn, 0x1bn, 0x22n, 0x2n, 0x2an, 0xan, 0x32n, 0x12n, 0x3an, 0x1an, 0x21n, 0x1n, 0x29n, 0x9n, 0x31n, 0x11n, 0x39n, 0x19n, 0x20n, 0x0n, 0x28n, 0x8n, 0x30n, 0x10n, 0x38n, 0x18n];
    const C3 = [0x1n, 0x1n, 0x2n, 0x2n, 0x2n, 0x2n, 0x2n, 0x2n, 0x1n, 0x2n, 0x2n, 0x2n, 0x2n, 0x2n, 0x2n, 0x1n];
    const C4 = [0x0n, 0x100001n, 0x300003n];
    const BIT_MASKS = [0x1n, 0x2n, 0x4n, 0x8n, 0x10n, 0x20n, 0x40n, 0x80n, 0x100n, 0x200n, 0x400n, 0x800n, 0x1000n, 0x2000n, 0x4000n, 0x8000n, 0x10000n, 0x20000n, 0x40000n, 0x80000n, 0x100000n, 0x200000n, 0x400000n, 0x800000n, 0x1000000n, 0x2000000n, 0x4000000n, 0x8000000n, 0x10000000n, 0x20000000n, 0x40000000n, 0x80000000n, 0x100000000n, 0x200000000n, 0x400000000n, 0x800000000n, 0x1000000000n, 0x2000000000n, 0x4000000000n, 0x8000000000n, 0x10000000000n, 0x20000000000n, 0x40000000000n, 0x80000000000n, 0x100000000000n, 0x200000000000n, 0x400000000000n, 0x800000000000n, 0x1000000000000n, 0x2000000000000n, 0x4000000000000n, 0x8000000000000n, 0x10000000000000n, 0x20000000000000n, 0x40000000000000n, 0x80000000000000n, 0x100000000000000n, 0x200000000000000n, 0x400000000000000n, 0x800000000000000n, 0x1000000000000000n, 0x2000000000000000n, 0x4000000000000000n, -0x8000000000000000n];
    const P = [0xfn, 0x6n, 0x13n, 0x14n, 0x1cn, 0xbn, 0x1bn, 0x10n, 0x0n, 0xen, 0x16n, 0x19n, 0x4n, 0x11n, 0x1en, 0x9n, 0x1n, 0x7n, 0x17n, 0xdn, 0x1fn, 0x1an, 0x2n, 0x8n, 0x12n, 0xcn, 0x1dn, 0x5n, 0x15n, 0xan, 0x3n, 0x18n];
    const Q = [0x38n, 0x30n, 0x28n, 0x20n, 0x18n, 0x10n, 0x8n, 0x0n, 0x39n, 0x31n, 0x29n, 0x21n, 0x19n, 0x11n, 0x9n, 0x1n, 0x3an, 0x32n, 0x2an, 0x22n, 0x1an, 0x12n, 0xan, 0x2n, 0x3bn, 0x33n, 0x2bn, 0x23n, 0x3en, 0x36n, 0x2en, 0x26n, 0x1en, 0x16n, 0xen, 0x6n, 0x3dn, 0x35n, 0x2dn, 0x25n, 0x1dn, 0x15n, 0xdn, 0x5n, 0x3cn, 0x34n, 0x2cn, 0x24n, 0x1cn, 0x14n, 0xcn, 0x4n, 0x1bn, 0x13n, 0xbn, 0x3n];
    const S = [0xdn, 0x10n, 0xan, 0x17n, 0x0n, 0x4n, -0x1n, -0x1n, 0x2n, 0x1bn, 0xen, 0x5n, 0x14n, 0x9n, -0x1n, -0x1n, 0x16n, 0x12n, 0xbn, 0x3n, 0x19n, 0x7n, -0x1n, -0x1n, 0xfn, 0x6n, 0x1an, 0x13n, 0xcn, 0x1n, -0x1n, -0x1n, 0x28n, 0x33n, 0x1en, 0x24n, 0x2en, 0x36n, -0x1n, -0x1n, 0x1dn, 0x27n, 0x32n, 0x2cn, 0x20n, 0x2fn, -0x1n, -0x1n, 0x2bn, 0x30n, 0x26n, 0x37n, 0x21n, 0x34n, -0x1n, -0x1n, 0x2dn, 0x29n, 0x31n, 0x23n, 0x1cn, 0x1fn, -0x1n, -0x1n];
    const SBOX = [[0xen, 0x4n, 0x3n, 0xfn, 0x2n, 0xdn, 0x5n, 0x3n, 0xdn, 0xen, 0x6n, 0x9n, 0xbn, 0x2n, 0x0n, 0x5n, 0x4n, 0x1n, 0xan, 0xcn, 0xfn, 0x6n, 0x9n, 0xan, 0x1n, 0x8n, 0xcn, 0x7n, 0x8n, 0xbn, 0x7n, 0x0n, 0x0n, 0xfn, 0xan, 0x5n, 0xen, 0x4n, 0x9n, 0xan, 0x7n, 0x8n, 0xcn, 0x3n, 0xdn, 0x1n, 0x3n, 0x6n, 0xfn, 0xcn, 0x6n, 0xbn, 0x2n, 0x9n, 0x5n, 0x0n, 0x4n, 0x2n, 0xbn, 0xen, 0x1n, 0x7n, 0x8n, 0xdn], [0xfn, 0x0n, 0x9n, 0x5n, 0x6n, 0xan, 0xcn, 0x9n, 0x8n, 0x7n, 0x2n, 0xcn, 0x3n, 0xdn, 0x5n, 0x2n, 0x1n, 0xen, 0x7n, 0x8n, 0xbn, 0x4n, 0x0n, 0x3n, 0xen, 0xbn, 0xdn, 0x6n, 0x4n, 0x1n, 0xan, 0xfn, 0x3n, 0xdn, 0xcn, 0xbn, 0xfn, 0x3n, 0x6n, 0x0n, 0x4n, 0xan, 0x1n, 0x7n, 0x8n, 0x4n, 0xbn, 0xen, 0xdn, 0x8n, 0x0n, 0x6n, 0x2n, 0xfn, 0x9n, 0x5n, 0x7n, 0x1n, 0xan, 0xcn, 0xen, 0x2n, 0x5n, 0x9n], [0xan, 0xdn, 0x1n, 0xbn, 0x6n, 0x8n, 0xbn, 0x5n, 0x9n, 0x4n, 0xcn, 0x2n, 0xfn, 0x3n, 0x2n, 0xen, 0x0n, 0x6n, 0xdn, 0x1n, 0x3n, 0xfn, 0x4n, 0xan, 0xen, 0x9n, 0x7n, 0xcn, 0x5n, 0x0n, 0x8n, 0x7n, 0xdn, 0x1n, 0x2n, 0x4n, 0x3n, 0x6n, 0xcn, 0xbn, 0x0n, 0xdn, 0x5n, 0xen, 0x6n, 0x8n, 0xfn, 0x2n, 0x7n, 0xan, 0x8n, 0xfn, 0x4n, 0x9n, 0xbn, 0x5n, 0x9n, 0x0n, 0xen, 0x3n, 0xan, 0x7n, 0x1n, 0xcn], [0x7n, 0xan, 0x1n, 0xfn, 0x0n, 0xcn, 0xbn, 0x5n, 0xen, 0x9n, 0x8n, 0x3n, 0x9n, 0x7n, 0x4n, 0x8n, 0xdn, 0x6n, 0x2n, 0x1n, 0x6n, 0xbn, 0xcn, 0x2n, 0x3n, 0x0n, 0x5n, 0xen, 0xan, 0xdn, 0xfn, 0x4n, 0xdn, 0x3n, 0x4n, 0x9n, 0x6n, 0xan, 0x1n, 0xcn, 0xbn, 0x0n, 0x2n, 0x5n, 0x0n, 0xdn, 0xen, 0x2n, 0x8n, 0xfn, 0x7n, 0x4n, 0xfn, 0x1n, 0xan, 0x7n, 0x5n, 0x6n, 0xcn, 0xbn, 0x3n, 0x8n, 0x9n, 0xen], [0x2n, 0x4n, 0x8n, 0xfn, 0x7n, 0xan, 0xdn, 0x6n, 0x4n, 0x1n, 0x3n, 0xcn, 0xbn, 0x7n, 0xen, 0x0n, 0xcn, 0x2n, 0x5n, 0x9n, 0xan, 0xdn, 0x0n, 0x3n, 0x1n, 0xbn, 0xfn, 0x5n, 0x6n, 0x8n, 0x9n, 0xen, 0xen, 0xbn, 0x5n, 0x6n, 0x4n, 0x1n, 0x3n, 0xan, 0x2n, 0xcn, 0xfn, 0x0n, 0xdn, 0x2n, 0x8n, 0x5n, 0xbn, 0x8n, 0x0n, 0xfn, 0x7n, 0xen, 0x9n, 0x4n, 0xcn, 0x7n, 0xan, 0x9n, 0x1n, 0xdn, 0x6n, 0x3n], [0xcn, 0x9n, 0x0n, 0x7n, 0x9n, 0x2n, 0xen, 0x1n, 0xan, 0xfn, 0x3n, 0x4n, 0x6n, 0xcn, 0x5n, 0xbn, 0x1n, 0xen, 0xdn, 0x0n, 0x2n, 0x8n, 0x7n, 0xdn, 0xfn, 0x5n, 0x4n, 0xan, 0x8n, 0x3n, 0xbn, 0x6n, 0xan, 0x4n, 0x6n, 0xbn, 0x7n, 0x9n, 0x0n, 0x6n, 0x4n, 0x2n, 0xdn, 0x1n, 0x9n, 0xfn, 0x3n, 0x8n, 0xfn, 0x3n, 0x1n, 0xen, 0xcn, 0x5n, 0xbn, 0x0n, 0x2n, 0xcn, 0xen, 0x7n, 0x5n, 0xan, 0x8n, 0xdn], [0x4n, 0x1n, 0x3n, 0xan, 0xfn, 0xcn, 0x5n, 0x0n, 0x2n, 0xbn, 0x9n, 0x6n, 0x8n, 0x7n, 0x6n, 0x9n, 0xbn, 0x4n, 0xcn, 0xfn, 0x0n, 0x3n, 0xan, 0x5n, 0xen, 0xdn, 0x7n, 0x8n, 0xdn, 0xen, 0x1n, 0x2n, 0xdn, 0x6n, 0xen, 0x9n, 0x4n, 0x1n, 0x2n, 0xen, 0xbn, 0xdn, 0x5n, 0x0n, 0x1n, 0xan, 0x8n, 0x3n, 0x0n, 0xbn, 0x3n, 0x5n, 0x9n, 0x4n, 0xfn, 0x2n, 0x7n, 0x8n, 0xcn, 0xfn, 0xan, 0x7n, 0x6n, 0xcn], [0xdn, 0x7n, 0xan, 0x0n, 0x6n, 0x9n, 0x5n, 0xfn, 0x8n, 0x4n, 0x3n, 0xan, 0xbn, 0xen, 0xcn, 0x5n, 0x2n, 0xbn, 0x9n, 0x6n, 0xfn, 0xcn, 0x0n, 0x3n, 0x4n, 0x1n, 0xen, 0xdn, 0x1n, 0x2n, 0x7n, 0x8n, 0x1n, 0x2n, 0xcn, 0xfn, 0xan, 0x4n, 0x0n, 0x3n, 0xdn, 0xen, 0x6n, 0x9n, 0x7n, 0x8n, 0x9n, 0x6n, 0xfn, 0x1n, 0x5n, 0xcn, 0x3n, 0xan, 0xen, 0x5n, 0x8n, 0x7n, 0xbn, 0x0n, 0x4n, 0xdn, 0x2n, 0xbn]];
    
    const applyMask = (arr: bigint[], len: number | bigint, val: bigint) => {
        let res = 0x0n;
        for (let i = 0; i < len; i++) {
            if (arr[i] < 0 || BigInt(val & BIT_MASKS[Number(arr[i])]) == 0x0n) continue;
            res |= BIT_MASKS[i];
        }
        return res;
    };
    
    const encryptBlock = (keyArr: bigint[], data: bigint) => {
        let res = applyMask(C1, 0x40n, data);
        let blocks = [0xffffffffn & res, (-0x100000000n & res) >> 0x20n];
        
        for (let i = 0; i < 16; i++) {
            let rightBlock = applyMask(C0, 0x40n, blocks[1]) ^ keyArr[i];
            let sboxOut = 0x0n;
            for (let j = 7; j > -1; j--) {
                const b = Number(0xffn & rightBlock >> BigInt(j) * 0x8n);
                sboxOut <<= 0x4n;
                sboxOut |= SBOX[j][b];
            }
            rightBlock = applyMask(P, 0x20n, sboxOut);
            
            let temp = blocks[0];
            blocks[0] = blocks[1];
            blocks[1] = temp ^ rightBlock;
        }
        
        blocks = blocks.reverse();
        res = (-0x100000000n & (blocks[1] << 0x20n)) | (0xffffffffn & blocks[0]);
        return applyMask(C2, 0x40n, res);
    };
    
    const prepareKey = (key: bigint, keyArr: bigint[]) => {
        let keyVal = applyMask(Q, 0x38n, key);
        for (let i = 0; i < 16; i++) {
            keyVal = (keyVal & C4[Number(C3[i])]) << (0x1cn - C3[i]) | (keyVal & ~C4[Number(C3[i])]) >> C3[i];
            keyArr[i] = applyMask(S, 0x40n, keyVal);
        }
    };
    
    return (text: string, keyStr = "ylzsxkwm") => {
        let keyInt = 0x0n;
        for (let i = 0; i < 8; i++) {
            keyInt |= BigInt(keyStr.charCodeAt(i)) << BigInt(i) * 0x8n;
        }
        
        let blockCount = Math.floor(text.length / 8);
        let keyArr = new Array(16).fill(0x0n);
        prepareKey(keyInt, keyArr);
        
        let dataBlocks = new Array(blockCount).fill(0x0n);
        for (let i = 0; i < blockCount; i++) {
            for (let j = 0; j < 8; j++) {
                dataBlocks[i] |= BigInt(text.charCodeAt(j + i * 8)) << BigInt(j) * 0x8n;
            }
        }
        
        let cipherBlocks = new Array(Math.floor((1 + 8 * (blockCount + 1)) / 8)).fill(0x0n);
        for (let i = 0; i < blockCount; i++) {
            cipherBlocks[i] = encryptBlock(keyArr, dataBlocks[i]);
        }
        
        let remainingStr = text.substring(blockCount * 8);
        let lastBlock = 0x0n;
        for (let i = 0; i < text.length % 8; i++) {
            lastBlock |= BigInt(remainingStr.charCodeAt(i)) << BigInt(i) * 0x8n;
        }
        cipherBlocks[blockCount] = encryptBlock(keyArr, lastBlock);
        
        let resArr = new Array(8 * cipherBlocks.length).fill(0);
        let idx = 0;
        cipherBlocks.forEach(block => {
            for (let i = 0; i < 8; i++) {
                resArr[idx++] = Number(0xffn & block >> BigInt(i) * 0x8n);
            }
        });
        
        return resArr;
    };
})();

// ==============================
// 酷我音乐
// ==============================

/** 移动端 convert_url_with_sign 明文接口；响应为 JSON。 */
const KUWO_MOBI_ENDPOINT = "https://mobi.kuwo.cn/mobi.s";
/** 块加密端点（f=kuwo&q=<base64>）。曾为主路径，现被酷我 nginx 层无条件 403。 */
const KUWO_ENCRYPTED_ENDPOINT = "https://mobi.kuwo.cn/mobi.s?f=kuwo&q=";
/** 块加密协议的固定请求密钥（客户端内置的协议常量，非应用密钥）。 */
const KUWO_REQUEST_KEY = "ylzsxkwm";

/**
 * 加密后的参数直接以 base64 明文拼在 q= 之后，不做百分号编码。
 * 与桌面端 Rust provider 以及仓库内 lx-music-sixyin.js 的实现逐字一致。
 */
const buildKuwoQuery = (params: string): string => {
    const bytes = kuwoCryptoAlgorithm(params, KUWO_REQUEST_KEY);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte & 0xff);
    return btoa(binary);
};

/**
 * 按音质从高到低排列候选码率，逐个尝试直到拿到可播地址。
 *
 * 不能只取第一个候选：请求 2000kflac 时上游会退回 100kbps 的 ogg，
 * 直接采用反而远差于 320kmp3，所以必须按 format 判断后继续往下找。
 */
const kuwoBitrateCandidates = (quality: string): string[] => {
    if (quality === "flac" || quality === "flac24bit" || quality === "ape") {
        return ["2000kflac", "320kmp3", "192kmp3", "128kmp3", "48kaac"];
    }
    if (quality === "320k") return ["320kmp3", "192kmp3", "128kmp3", "48kaac"];
    if (quality === "192k") return ["192kmp3", "128kmp3", "48kaac"];
    return ["128kmp3", "48kaac"];
};

/**
 * convert_url_with_sign 的响应是 JSON。
 *
 * code=407 是酷我的地区版权封锁：对非中国大陆出口 IP，接口仍返回 200，
 * 但 data 里全是字符串 "None"，msg 为 "not available in your region"。
 * 实测 Cloudflare 的出口 IP（含 US 各 colo）一律命中该分支，因此在
 * Pages Functions 里原生酷我解析无法成功——只能依赖 GD Studio 解析、
 * 或由未被封锁的出口代为解析。酷我的音频 CDN 本身不封锁，地址一旦拿到
 * 就能正常播放。
 *
 * bitrate=1 是 VIP / 版权受限标记（与桌面端 Rust provider 的
 * parse_kuwo_url 一致），此时即便带 url 字段也不可播放。
 */
const parseKuwoResponse = (data: any): ResolveResult => {
    if (Number(data?.code) === 407) return { url: null, reason: "region" };

    const payload = data?.data;
    if (!payload) return { url: null, reason: "unavailable" };
    if (Number(payload.bitrate) === 1) return { url: null, reason: "vip" };

    const candidate = typeof payload.url === "string" ? payload.url.trim() : "";
    if (!isPlayableUrl(candidate)) return { url: null, reason: "unavailable" };
    return { url: candidate };
};

/** 加密端点的响应是 key=value 文本行。 */
const parseKuwoEncryptedResponse = (body: string): ResolveResult => {
    const lines = body.split(/\r?\n/).map((line) => line.trim());

    if (lines.includes("bitrate=1")) return { url: null, reason: "vip" };

    for (const line of lines) {
        if (!line.startsWith("url=")) continue;
        const candidate = line.slice("url=".length).trim();
        if (isPlayableUrl(candidate)) return { url: candidate };
    }

    return { url: null, reason: "unavailable" };
};

/**
 * 主路径：移动端 convert_url_with_sign 明文协议。
 *
 * 从前的实现走 f=kuwo&q=<块加密> 端点，该端点现已被酷我 nginx 层无条件
 * 拒绝（HTTP 403）——换 UA、换主机、换 http/https、换请求体都无效，
 * 客户端无解，只能弃用。这个明文接口仍然可用，且会返回真实的
 * bitrate / format，便于按格式做质量判断。
 */
async function getKuwoUrlPrimary(songmid: string, quality: string): Promise<ResolveResult> {
    /** 已拿到地址但不是首选格式（ogg/aac）时的降级结果。 */
    let degradedUrl: string | null = null;
    let sawVip = false;

    for (const br of kuwoBitrateCandidates(quality)) {
        const apiUrl =
            `${KUWO_MOBI_ENDPOINT}?f=web&type=convert_url_with_sign&source=jiakong` +
            `&rid=${encodeURIComponent(songmid)}&br=${br}`;

        const resp = await fetch(apiUrl, {
            method: "GET",
            headers: {
                'User-Agent': getRandomUserAgent(),
                'Referer': "http://kuwo.cn/"
            }
        });

        if (!resp.ok) continue;

        const data = await resp.json().catch(() => null);
        const result = parseKuwoResponse(data);

        // 地区封锁与候选码率无关，继续试只会白白多打几个必然失败的请求。
        if (result.reason === "region") return result;

        if (result.url) {
            const format = String(data?.data?.format || "").toLowerCase();
            // mp3 / flac 是首选，直接采用；ogg / aac 先记下，继续试更低的候选码率。
            if (format === "mp3" || format === "flac") return result;
            degradedUrl ??= result.url;
            continue;
        }

        if (result.reason === "vip") sawVip = true;
    }

    if (degradedUrl) return { url: degradedUrl };
    return { url: null, reason: sawVip ? "vip" : "unavailable" };
}

const kuwoEncryptedBitrateFor = (quality: string): [string, string] => {
    if (quality === "320k") return ["320kmp3", "mp3"];
    if (quality === "192k") return ["192kmp3", "mp3"];
    if (quality === "ape") return ["2000kape", "ape"];
    if (quality === "flac" || quality === "flac24bit") return ["2000kflac", "flac"];
    return ["128kmp3", "mp3"];
};

/**
 * 兜底：块加密端点。
 *
 * 当前被上游 nginx 层无条件 403，因此只在主路径拿到「上游没有可用地址」
 * 时才会尝试一次。保留实现是为了在端点恢复、或换用别的 Kuwo 网关时
 * 能直接切回来，不必再走一遍协议逆向。
 */
async function getKuwoUrlEncrypted(songmid: string, quality: string): Promise<ResolveResult> {
    const [bitrate, format] = kuwoEncryptedBitrateFor(quality);
    const params =
        `type=convert_url&br=${bitrate}&format=${format}&sig=0&rid=${songmid}` +
        `&network=wifi&response=url&prod=kwplayer_ar_10.3.3.0`;

    const resp = await fetch(`${KUWO_ENCRYPTED_ENDPOINT}${buildKuwoQuery(params)}`, {
        method: "GET",
        headers: {
            'User-Agent': getRandomUserAgent(),
            'Referer': "http://kuwo.cn/"
        }
    });

    if (!resp.ok) throw new Error(`Kuwo responded HTTP ${resp.status}`);

    return parseKuwoEncryptedResponse(await resp.text());
}

/**
 * 酷我解析入口：明文协议优先；只有它明确回答「没有可用地址」时才试一次
 * 旧加密端点。VIP 与地区封锁都是权威结论，不必再试。
 */
async function getKuwoUrl(songmid: string, quality: string): Promise<ResolveResult> {
    const primary = await getKuwoUrlPrimary(songmid, quality);
    if (primary.url || primary.reason === "vip" || primary.reason === "region") {
        return primary;
    }

    try {
        const fallback = await getKuwoUrlEncrypted(songmid, quality);
        return fallback.url ? fallback : primary;
    } catch {
        return primary;
    }
}
