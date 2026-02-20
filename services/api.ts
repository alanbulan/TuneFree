import { Song, TopList, TuneHubMethod, TuneHubResponse } from '../types';

// Default API Base URL provided by user documentation
export const DEFAULT_API_BASE = 'https://tunehub.sayqz.com/api';

const FORBIDDEN_HEADERS = [
    'user-agent', 'referer', 'host', 'origin', 'cookie', 
    'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 
    'connection', 'content-length'
];

// 恢复 corsproxy.io 为首选，因为它对 Referer 支持最好（QQ 必须）
// 增加备用代理以防万一
const DEFAULT_PROXIES = [
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://api.allorigins.win/raw?url=',
];

const getStoredApiKey = () => localStorage.getItem('tunefree_api_key') || '';
const getStoredProxy = () => localStorage.getItem('tunefree_cors_proxy') || null;

// 获取存储的 API Base，如果没有则使用默认值
export const getStoredApiBase = () => {
    let base = localStorage.getItem('tunefree_api_base') || DEFAULT_API_BASE;
    // 移除末尾的斜杠，防止拼接时出现双斜杠
    if (base.endsWith('/')) base = base.slice(0, -1);
    return base;
};

// 辅助函数：修复 URL
const fixUrl = (url: string | undefined): string => {
    if (!url || typeof url !== 'string') return '';
    let fixed = url;

    // 1. 保留酷我 CDN 域名（kwcdn.kuwo.cn 是音频/图片 CDN，不能替换为主页域名 kuwo.cn）

    // 2. 移除 URL 中的换行符或空白
    fixed = fixed.trim();

    // 3. 修复协议 (仅针对明显缺失协议的)
    if (fixed.startsWith('//')) {
        fixed = `https:${fixed}`;
    }

    // 4. 强制 HTTPS (针对已知支持 HTTPS 的图床；酷我 CDN kwcdn.kuwo.cn 证书无效，保持 HTTP)
    if (fixed.startsWith('http://')) {
        if (
            fixed.includes('music.126.net') ||
            fixed.includes('y.gtimg.cn') ||
            fixed.includes('qpic.cn')
        ) {
            fixed = fixed.replace('http://', 'https://');
        }
    }

    // 5. 修复 QQ 图片尺寸 (300x300M000 -> 500x500M000 获得清晰图)
    if (fixed.includes('300x300')) {
        fixed = fixed.replace('300x300', '500x500');
    }

    return fixed;
};

// 深度查找 ID
const findId = (item: any, platform: string): string | undefined => {
    if (!item) return undefined;
    
    // QQ Specific — parse API 需要 songmid（字母数字格式），优先于 numeric id
    if (platform === 'qq') {
        if (item.songmid) return String(item.songmid);
        if (item.mid) return String(item.mid);
        if (item.file?.media_mid) return String(item.file.media_mid);
        if (item.topId) return String(item.topId);
        if (item.id) return String(item.id);
    }
    
    // Kuwo Specific
    if (platform === 'kuwo') {
        if (item.rid) return String(item.rid);
        if (item.musicrid) return String(item.musicrid);
    }
    
    // Generic
    if (item.id) return String(item.id);
    if (item.ID) return String(item.ID);
    
    return undefined;
};

// 暴力查找图片字段
const findImage = (item: any): string => {
    if (!item) return '';
    const keys = [
        'picUrl', 'coverImgUrl', 'pic', 'pic_v12', 'frontPicUrl',
        'headPicUrl', 'img', 'cover', 'imgUrl', 'album_pic', 'albumpic'
    ];
    for (const key of keys) {
        if (item[key] && typeof item[key] === 'string') {
            return item[key];
        }
    }
    // QQ 嵌套查找
    if (item.mac_detail && item.mac_detail.pic_v12) return item.mac_detail.pic_v12;
    return '';
};

/** 从原始 API 响应中提取歌曲原始数组（用于从 transform 后补回封面） */
const extractRawTracks = (data: any): any[] => {
    if (!data) return [];
    // 网易云: result.tracks / playlist.tracks
    if (data.result?.tracks) return data.result.tracks;
    if (data.playlist?.tracks) return data.playlist.tracks;
    // 网易云搜索: result.songs
    if (data.result?.songs) return data.result.songs;
    // QQ: toplist.data.songInfoList / req.data.body.song.list / data.songlist
    if (data.toplist?.data?.songInfoList) return data.toplist.data.songInfoList;
    if (data.req?.data?.body?.song?.list) return data.req.data.body.song.list;
    if (data.data?.songlist) return data.data.songlist;
    if (data.data?.song?.list) return data.data.song.list;
    // 酷我: musiclist / abslist
    if (data.musiclist) return data.musiclist;
    if (data.abslist) return data.abslist;
    return [];
};

// 核心：智能列表提取器
const extractList = (data: any): any[] => {
    if (!data) return [];
    
    // 1. 显式处理 QQ 榜单的分组结构 (Flatten)
    // 兼容 groupList, group, 以及 topList, list, toplist
    const flattenGroup = (groupArr: any[]) => {
        return groupArr.flatMap((g: any) => g.toplist || g.topList || g.list || []);
    };

    if (data.data?.groupList) return flattenGroup(data.data.groupList);
    if (data.data?.group) return flattenGroup(data.data.group);
    if (data.groupList) return flattenGroup(data.groupList);
    if (data.group) return flattenGroup(data.group);

    // QQ 嵌套路径兜底（transform 崩溃时 rawData 回落到这里）
    if (data.toplist?.data?.songInfoList) return data.toplist.data.songInfoList;
    if (data.req?.data?.body?.song?.list) return data.req.data.body.song.list;

    // 2. 如果本身是数组
    if (Array.isArray(data)) {
        // 检查是否为分组数组
        const first = data[0];
        if (first && (first.toplist || first.topList || first.list || first.groupName)) {
             return flattenGroup(data);
        }
        return data;
    }

    // 3. 常见列表字段名优先级
    const priorityKeys = ['tracks', 'songs', 'list', 'songlist', 'toplist', 'topList', 'data', 'result', 'results', 'hotSongs'];
    
    // 检查第一层
    for (const key of priorityKeys) {
        if (data[key] && Array.isArray(data[key])) {
             const arr = data[key];
             const first = arr[0];
             // 再次检查内部是否为分组
             if (first && (first.toplist || first.topList || first.list || first.groupName)) {
                 return flattenGroup(arr);
             }
             return arr;
        }
    }

    // 检查 data.xxx (常见包裹)
    if (data.data) {
        if (Array.isArray(data.data)) {
             const arr = data.data;
             const first = arr[0];
             if (first && (first.toplist || first.topList || first.list || first.groupName)) {
                 return flattenGroup(arr);
             }
             return arr;
        }
        for (const key of priorityKeys) {
            if (data.data[key] && Array.isArray(data.data[key])) {
                return data.data[key];
            }
        }
    }

    // 4. 兜底
    if (data.id && data.name) return [data];

    return [];
};

// 辅助函数：标准化歌曲对象
const normalizeSongs = (list: any[], platform: string): Song[] => {
    if (!Array.isArray(list)) return [];
    return list.map(item => {
        if (!item) return null;
        
        // Unwrap data.data (QQ)
        const actualItem = item.data ? item.data : item;

        const id = findId(actualItem, platform);
        
        // Artist
        let artist = actualItem.artist;
        if (!artist) {
            if (Array.isArray(actualItem.ar)) artist = actualItem.ar.map((a:any) => a.name).join('/');
            else if (Array.isArray(actualItem.artists)) artist = actualItem.artists.map((a:any) => a.name).join('/');
            else if (Array.isArray(actualItem.singer)) artist = actualItem.singer.map((s:any) => s.name).join('/');
            else if (Array.isArray(actualItem.singerList)) artist = actualItem.singerList.map((s:any) => s.name).join('/');
            else if (actualItem.artist_name) artist = actualItem.artist_name;
        }

        // Album
        let album = actualItem.album;
        if (typeof album === 'object' && album !== null && album.name) {
            album = album.name;
        } else if (!album && actualItem.album_name) {
            album = actualItem.album_name;
        } else if (!album && actualItem.albumname) {
            album = actualItem.albumname;
        } else if (!album && actualItem.albumName) {
            album = actualItem.albumName;
        }

        // Picture
        let pic = findImage(actualItem);
        
        if (!pic && actualItem.al?.picUrl) pic = actualItem.al.picUrl;
        if (!pic && actualItem.album?.picUrl) pic = actualItem.album.picUrl;
        
        // QQ Cover Logic Fallback
        if (!pic && platform === 'qq') {
            const mid = actualItem.albummid || actualItem.album?.mid || actualItem.album_mid;
            if (mid) {
                pic = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg`;
            } 
        }

        pic = fixUrl(pic);

        // 如果 ID 找不到，生成临时 ID
        const finalId = id !== undefined ? id : `temp_${Math.random().toString(36).slice(2)}`;

        return {
            ...actualItem,
            source: platform,
            id: finalId,
            name: String(actualItem.name || actualItem.title || actualItem.songname || 'Unknown Song'),
            artist: String(artist || 'Unknown Artist'),
            album: String(album || ''),
            pic: String(pic || ''),
            isValidId: id !== undefined
        };
    }).filter(Boolean) as Song[];
};

async function tuneHubFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T | null> {
    const apiKey = getStoredApiKey();
    const apiBase = getStoredApiBase(); // Use dynamic base

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as any) || {}),
    };

    if (apiKey) {
        headers['X-API-Key'] = apiKey;
    }

    try {
        const response = await fetch(`${apiBase}${endpoint}`, { ...options, headers });
        
        // Handle HTML response error (404/503 returning default pages)
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
             console.error(`TuneHub API Error [${endpoint}]: Received HTML instead of JSON. Check API_BASE (${apiBase}).`);
             return null;
        }

        if (response.status === 401) {
            console.warn('TuneHub: Unauthorized.');
            return null;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) {
        console.error(`TuneHub API Error [${endpoint}]:`, e);
        return null;
    }
}

export async function executeMethod<T>(platform: string, fn: string, variables: Record<string, string> = {}): Promise<T | null> {
    const res = await tuneHubFetch<TuneHubResponse<TuneHubMethod>>(`/v1/methods/${platform}/${fn}`);
    if (!res || res.code !== 0 || !res.data) return null;

    const config = res.data;
    
    const storedProxy = getStoredProxy();
    const proxies = storedProxy ? [storedProxy] : DEFAULT_PROXIES;
    
    // 模板表达式求值 — 支持 {{keyword}}, {{page || 1}}, {{parseInt(id)}} 等
    const evalExpr = (expr: string): any => {
        try {
            const keys = Object.keys(variables);
            const vals = keys.map(k => variables[k]);
            return new Function(...keys, `"use strict"; return (${expr});`)(...vals);
        } catch { return ''; }
    };

    // 替换字符串中的 {{expr}} 模板变量
    const replaceTemplate = (str: string): string => {
        return str.replace(/\{\{(.*?)\}\}/g, (_, expr) => String(evalExpr(expr)));
    };

    // 递归处理 body 对象中的模板变量（保留原始类型，如 parseInt 返回 number）
    const processBody = (obj: any): any => {
        if (typeof obj === 'string') {
            const fullMatch = obj.match(/^\{\{(.*)\}\}$/);
            if (fullMatch) return evalExpr(fullMatch[1]);
            return replaceTemplate(obj);
        }
        if (Array.isArray(obj)) return obj.map(processBody);
        if (typeof obj === 'object' && obj !== null) {
            const result: any = {};
            for (const [k, v] of Object.entries(obj)) result[k] = processBody(v);
            return result;
        }
        return obj;
    };

    let requestUrl = replaceTemplate(config.url);
    if (config.params) {
        const finalParams = new URLSearchParams();
        for (const [k, v] of Object.entries(config.params)) {
            finalParams.append(k, replaceTemplate(v));
        }
        requestUrl += (requestUrl.includes('?') ? '&' : '?') + finalParams.toString();
    }

    const safeHeaders: Record<string, string> = {};
    if (config.headers) {
        for (const [k, v] of Object.entries(config.headers)) {
            if (!FORBIDDEN_HEADERS.includes(k.toLowerCase())) {
                safeHeaders[k] = v;
            }
        }
    }

    requestUrl = fixUrl(requestUrl);

    for (const proxy of proxies) {
        let finalFetchUrl = `${proxy}${encodeURIComponent(requestUrl)}`;
        
        if (proxy.includes('allorigins')) {
            finalFetchUrl += `&_t=${Date.now()}`;
        }
        
        try {
            console.log(`Trying proxy: ${proxy} -> ${requestUrl}`);

            // 构建 fetch 选项（POST 请求需带 body，QQ 音乐必需）
            const fetchOpts: RequestInit = {
                method: config.method,
                headers: safeHeaders,
                mode: 'cors',
                credentials: 'omit'
            };
            if (config.body) {
                fetchOpts.body = JSON.stringify(processBody(config.body));
                if (!safeHeaders['Content-Type']) {
                    safeHeaders['Content-Type'] = 'application/json';
                }
            }

            const response = await fetch(finalFetchUrl, fetchOpts);
            
            // Critical Change: Read as TEXT first to handle JSONP or malformed JSON
            const rawText = await response.text();
            
            let rawData: any = null;
            
            // 1. Try standard JSON parsing
            try {
                rawData = JSON.parse(rawText);
            } catch (e) {
                // 2. Try cleaning JSONP (Callback wrapping)
                // Looks like:  MusicJsonCallback({...}) or callback({...})
                try {
                    const match = rawText.match(/^\s*[\w\.]+\s*\((.*)\)\s*;?\s*$/s);
                    if (match && match[1]) {
                         rawData = JSON.parse(match[1]);
                    }
                } catch (e2) {
                    // console.warn("JSONP parse failed", e2);
                }
            }
            
            // 3. Check for AllOrigins wrapper
            if (rawData && rawData.contents && rawData.status?.url) {
                try {
                    rawData = JSON.parse(rawData.contents);
                } catch (e) {
                    // contents might be string or JSONP
                    const contentText = rawData.contents;
                    try {
                        rawData = JSON.parse(contentText);
                    } catch {
                        const match = contentText.match(/^\s*[\w\.]+\s*\((.*)\)\s*;?\s*$/s);
                        if (match && match[1]) {
                            try { rawData = JSON.parse(match[1]); } catch {}
                        }
                    }
                }
            }

            if (!rawData) {
                console.warn(`Proxy ${proxy} returned unparsable data.`);
                continue;
            }

            // === GARBAGE DATA DETECTION ===
            if (Array.isArray(rawData) && rawData.length > 0 && (rawData[0] === "-1" || rawData[0] === -1)) {
                console.warn(`Proxy ${proxy} returned garbage data. Skipping.`);
                continue;
            }
            if (rawData.code === -447) {
                 console.warn(`Proxy ${proxy} returned Netease -447.`);
                 continue;
            }

            if (config.transform) {
                try {
                    const transformer = new Function(`return ${config.transform}`)();
                    const transformed = transformer(rawData);

                    // transform 返回无效值时直接 fallback
                    if (!transformed) {
                        return rawData;
                    }

                    // TuneHub 的 transform 函数普遍丢弃了封面字段
                    // 这里从原始数据中补回封面 URL
                    if (Array.isArray(transformed) && transformed.length > 0 && !transformed[0].pic) {
                        const rawTracks = extractRawTracks(rawData);
                        if (rawTracks.length > 0) {
                            // 优先按 ID 匹配，回退到按索引
                            const idToRaw = new Map<string, any>();
                            for (const rt of rawTracks) {
                                const rid = String(rt.id || rt.rid || rt.songid || rt.songmid || rt.MUSICRID || '').replace('MUSIC_', '');
                                if (rid) idToRaw.set(rid, rt);
                            }
                            for (let i = 0; i < transformed.length; i++) {
                                const item = transformed[i];
                                const raw = idToRaw.get(String(item.id)) || rawTracks[i];
                                if (!raw) continue;
                                // 网易云: album.picUrl / al.picUrl
                                let pic = raw.al?.picUrl || raw.album?.picUrl || findImage(raw) || '';
                                // QQ: 通过 albummid 构造封面
                                if (!pic) {
                                    const mid = raw.albummid || raw.album?.mid || raw.album_mid;
                                    if (mid) pic = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg`;
                                }
                                if (pic) item.pic = pic;
                            }
                        }
                    }

                    return transformed;
                } catch (e) {
                    // transform 失败时回退到原始数据（由 normalizeSongs 兜底解析）
                    console.log("[Transform] fallback to rawData:", (e as Error)?.message);
                    return rawData;
                }
            }
            return rawData;
        } catch (e) {
            console.warn(`Fetch failed via proxy ${proxy}:`, e);
        }
    }

    console.error("All proxies failed.");
    return null;
}

export const parseSongs = async (ids: string, platform: string, quality: string = '320k') => {
    if (!ids || !platform) return null;
    if (String(ids).startsWith('temp_')) return null;

    const res = await tuneHubFetch<TuneHubResponse<any>>('/v1/parse', {
        method: 'POST',
        body: JSON.stringify({ platform, ids, quality })
    });

    if (!res || !res.data) return null;
    return extractList(res.data);
};

export const getSongInfo = async (id: string | number, source: string): Promise<any | null> => {
    const data = await parseSongs(String(id), source);
    if (!data || data.length === 0) return null;
    const song = normalizeSongs(data, source)[0];
    return song;
};

export const getLyrics = async (id: string | number, source: string): Promise<string> => {
    // 先尝试 TuneHub parse 获取歌词
    const data = await parseSongs(String(id), source);
    const lrc = data?.[0]?.lrc || data?.[0]?.lyric || data?.[0]?.lyrics || "";
    if (lrc) return lrc;

    // parse 未返回歌词，使用平台原生歌词 API 作为备用
    return fetchFallbackLyrics(id, source);
};

export const getSongUrl = async (id: string | number, source: string, quality: string = '320k'): Promise<string | null> => {
    if (!source || source === 'undefined') return null;
    const data = await parseSongs(String(id), source, quality);
    let url = data?.[0]?.url;
    return fixUrl(url) || null;
};

// 解析缓存 — 避免同一首歌重复调用 parse 浪费积分
const _parseCache = new Map<string, { data: any[]; timestamp: number }>();
const PARSE_CACHE_TTL = 5 * 60 * 1000; // 5 分钟过期

// 歌词缓存 — 避免重复请求备用歌词 API
const _lyricsCache = new Map<string, string>();

/** 平台原生歌词 API 备用获取 */
const fetchFallbackLyrics = async (id: string | number, source: string): Promise<string> => {
    const cacheKey = `lrc:${source}:${id}`;
    if (_lyricsCache.has(cacheKey)) return _lyricsCache.get(cacheKey)!;

    let lrc = '';
    try {
        if (source === 'netease') {
            const resp = await proxyFetchJson(`http://music.163.com/api/song/lyric?id=${id}&lv=1&tv=1`);
            const main = resp?.lrc?.lyric || '';
            const trans = resp?.tlyric?.lyric || '';
            lrc = main && trans ? main + '\n' + trans : main;
        } else if (source === 'qq') {
            // 使用 musicu.fcg 统一接口获取歌词（旧 fcg_query_lyric_new 需要 Referer 头，CORS 代理下返回 -1310）
            const body = {
                comm: { ct: 11, cv: 1003006, v: 1003006, os_ver: '12', phonetype: 0, buildnum: 166, tmeLoginType: 2 },
                req: {
                    module: 'music.musichallSong.PlayLyricInfo',
                    method: 'GetPlayLyricInfo',
                    param: { songMID: String(id), songID: 0 }
                }
            };
            const storedProxy = getStoredProxy();
            const proxies = storedProxy ? [storedProxy] : DEFAULT_PROXIES;
            for (const proxy of proxies) {
                try {
                    const finalUrl = `${proxy}${encodeURIComponent('https://u.y.qq.com/cgi-bin/musicu.fcg')}`;
                    const resp = await fetch(finalUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                        mode: 'cors',
                        credentials: 'omit'
                    });
                    const data = await resp.json();
                    const lyricB64 = data?.req?.data?.lyric || '';
                    const transB64 = data?.req?.data?.trans || '';
                    // Base64 解码（QQ 歌词 API 返回 Base64 编码的 LRC 文本）
                    const main = lyricB64 ? decodeURIComponent(escape(atob(lyricB64))) : '';
                    const trans = transB64 ? decodeURIComponent(escape(atob(transB64))) : '';
                    if (main) {
                        lrc = main && trans ? main + '\n' + trans : main;
                        break;
                    }
                } catch { /* 继续下一个代理 */ }
            }
        } else if (source === 'kuwo') {
            // 优先使用 openapi 端点（兼容性更好，songinfoandlrc 对部分歌曲 ID 返回 301）
            let lrcList: any[] | null = null;
            const openApiResp = await proxyFetchJson(`https://kuwo.cn/openapi/v1/www/lyric/getlyric?musicId=${id}`);
            if (openApiResp?.data?.lrclist) {
                lrcList = openApiResp.data.lrclist;
            } else {
                // 备用：songinfoandlrc（httpsStatus=1 防止 301 重定向）
                const fallbackResp = await proxyFetchJson(`http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${id}&httpsStatus=1`);
                if (fallbackResp?.data?.lrclist) {
                    lrcList = fallbackResp.data.lrclist;
                }
            }
            if (Array.isArray(lrcList)) {
                lrc = lrcList.map((l: any) => {
                    const t = parseFloat(l.time || '0');
                    const min = Math.floor(t / 60).toString().padStart(2, '0');
                    const sec = (t % 60).toFixed(2).padStart(5, '0');
                    return `[${min}:${sec}]${l.lineLyric || ''}`;
                }).join('\n');
            }
        }
    } catch (e) {
        console.warn('备用歌词 API 获取失败:', e);
    }

    _lyricsCache.set(cacheKey, lrc);
    return lrc;
};

// 一次 parse 获取 url + 歌词 + 封面，供 playSong 使用
export const parseSongFull = async (
    id: string | number, platform: string, quality: string = '320k'
): Promise<{ url: string | null; lrc: string; pic: string } | null> => {
    if (!id || !platform || String(id).startsWith('temp_')) return null;

    const cacheKey = `${platform}:${id}:${quality}`;
    const cached = _parseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < PARSE_CACHE_TTL) {
        const item = cached.data[0];
        const normalized = normalizeSongs(cached.data, platform)[0];
        let lrc = item?.lrc || item?.lyric || item?.lyrics || '';
        if (!lrc) lrc = await fetchFallbackLyrics(id, platform);
        return {
            url: fixUrl(item?.url) || null,
            lrc,
            pic: normalized?.pic || ''
        };
    }

    const data = await parseSongs(String(id), platform, quality);
    if (!data || data.length === 0) return null;

    _parseCache.set(cacheKey, { data, timestamp: Date.now() });

    const item = data[0];
    const normalized = normalizeSongs(data, platform)[0];
    let lrc = item?.lrc || item?.lyric || item?.lyrics || '';

    // parse 未返回歌词时，异步获取备用歌词（不阻塞 URL 返回）
    if (!lrc) {
        lrc = await fetchFallbackLyrics(id, platform);
    }

    return {
        url: fixUrl(item?.url) || null,
        lrc,
        pic: normalized?.pic || ''
    };
};

// ====== 网易云备用接口（绕过 -447 反爬） ======
// TuneHub 返回的 method config 使用 music.163.com/api/search/get/web，已被加密
// 以下使用经验证可用的替代接口

/** 通过 CORS 代理请求外部 URL 并返回 JSON */
const proxyFetchJson = async (url: string): Promise<any> => {
    const storedProxy = getStoredProxy();
    const proxies = storedProxy ? [storedProxy] : DEFAULT_PROXIES;
    for (const proxy of proxies) {
        try {
            const finalUrl = proxy.includes('allorigins')
                ? `${proxy}${encodeURIComponent(url)}&_t=${Date.now()}`
                : `${proxy}${encodeURIComponent(url)}`;
            const resp = await fetch(finalUrl, { mode: 'cors', credentials: 'omit' });
            const text = await resp.text();
            let data: any = null;
            try { data = JSON.parse(text); } catch {
                // JSONP 兜底
                const m = text.match(/^\s*[\w.]+\s*\((.*)\)\s*;?\s*$/s);
                if (m) data = JSON.parse(m[1]);
            }
            // AllOrigins 解包
            if (data && data.contents && data.status?.url) {
                try { data = JSON.parse(data.contents); } catch {}
            }
            if (data) return data;
        } catch { /* 继续下一个代理 */ }
    }
    return null;
};

/** QQ 搜索备用：使用 ct=11（移动客户端标识）避免 ct=23 被限流 */
const qqSearchFallback = async (keyword: string, page: number, limit: number): Promise<Song[]> => {
    const body = {
        comm: { ct: 11, cv: 1003006, v: 1003006, os_ver: '12', phonetype: 0, buildnum: 166, tmeLoginType: 2 },
        req: {
            method: 'DoSearchForQQMusicDesktop',
            module: 'music.search.SearchCgiService',
            param: { query: keyword, page_num: page, num_per_page: limit }
        }
    };
    const storedProxy = getStoredProxy();
    const proxies = storedProxy ? [storedProxy] : DEFAULT_PROXIES;
    for (const proxy of proxies) {
        try {
            const finalUrl = `${proxy}${encodeURIComponent('https://u.y.qq.com/cgi-bin/musicu.fcg')}`;
            const resp = await fetch(finalUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                mode: 'cors',
                credentials: 'omit'
            });
            const data = await resp.json();
            const songs = data?.req?.data?.body?.song?.list;
            if (!songs || !Array.isArray(songs) || songs.length === 0) continue;
            return songs.map((s: any) => ({
                id: s.mid || String(s.id),
                name: s.name || '',
                artist: s.singer?.map((si: any) => si.name).join(', ') || '',
                album: s.album?.name || '',
                // QQ 封面：用 albumMid 构造高清封面 URL
                pic: s.album?.mid ? fixUrl(`https://y.gtimg.cn/music/photo_new/T002R500x500M000${s.album.mid}.jpg`) : '',
                source: 'qq'
            }));
        } catch { /* 继续下一个代理 */ }
    }
    return [];
};

/** 网易云搜索备用：cloudsearch/pc（未加密，支持分页） */
const neteaseSearchFallback = async (keyword: string, page: number, limit: number): Promise<Song[]> => {
    const offset = (page - 1) * limit;
    const url = `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(keyword)}&type=1&offset=${offset}&limit=${limit}`;
    const data = await proxyFetchJson(url);
    const songs = data?.result?.songs;
    if (!songs || !Array.isArray(songs)) return [];
    return songs.map((s: any) => ({
        id: String(s.id),
        name: s.name || '',
        artist: s.ar?.map((a: any) => a.name).join(', ') || '',
        album: s.al?.name || '',
        pic: fixUrl(s.al?.picUrl || ''),
        source: 'netease'
    }));
};

/** 网易云榜单列表备用：/api/toplist/detail */
const neteaseToplistsFallback = async (): Promise<TopList[]> => {
    const data = await proxyFetchJson('https://music.163.com/api/toplist/detail');
    const list = data?.list;
    if (!list || !Array.isArray(list)) return [];
    return list.map((item: any) => ({
        id: String(item.id),
        name: item.name || '',
        updateFrequency: item.updateFrequency || '',
        picUrl: fixUrl(item.coverImgUrl || ''),
        coverImgUrl: fixUrl(item.coverImgUrl || '')
    }));
};

/** 网易云榜单详情备用：/api/v6/playlist/detail */
const neteaseToplistDetailFallback = async (id: string | number): Promise<Song[]> => {
    const url = `https://music.163.com/api/v6/playlist/detail?id=${id}&n=30`;
    const data = await proxyFetchJson(url);
    const tracks = data?.playlist?.tracks;
    if (!tracks || !Array.isArray(tracks)) return [];
    return tracks.map((s: any) => ({
        id: String(s.id),
        name: s.name || '',
        artist: s.ar?.map((a: any) => a.name).join(', ') || '',
        album: s.al?.name || '',
        pic: fixUrl(s.al?.picUrl || ''),
        source: 'netease'
    }));
};

// ====== 酷我备用接口 ======

/** 批量获取酷我歌曲封面（通过 artistpicserver 接口，并行请求） */
const batchFetchKuwoCovers = async (songs: Song[]): Promise<Song[]> => {
    if (songs.length === 0) return songs;
    const storedProxy = getStoredProxy();
    const proxy = storedProxy || DEFAULT_PROXIES[0];

    const coverPromises = songs.map(async (song) => {
        if (song.pic || !song.id) return song;
        try {
            const apiUrl = `http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${song.id}`;
            const resp = await fetch(`${proxy}${encodeURIComponent(apiUrl)}`, {
                mode: 'cors', credentials: 'omit'
            });
            const picUrl = (await resp.text()).trim();
            if (picUrl && picUrl.startsWith('http')) {
                return { ...song, pic: fixUrl(picUrl) };
            }
        } catch { /* 单首封面获取失败不影响整体 */ }
        return song;
    });

    return Promise.all(coverPromises);
};

/** 酷我搜索备用：旧版 search.kuwo.cn/r.s（无需 CSRF） */
const kuwoSearchFallback = async (keyword: string, page: number, limit: number): Promise<Song[]> => {
    const pn = page - 1; // 旧版 API 从 0 开始
    const rawUrl = `http://search.kuwo.cn/r.s?all=${encodeURIComponent(keyword)}&ft=music&itemset=web_2013&pn=${pn}&rn=${limit}&encoding=utf8&rformat=json&moession=1&vkey=VKEY`;
    const storedProxy = getStoredProxy();
    const proxies = storedProxy ? [storedProxy] : DEFAULT_PROXIES;
    for (const proxy of proxies) {
        try {
            const finalUrl = proxy.includes('allorigins')
                ? `${proxy}${encodeURIComponent(rawUrl)}&_t=${Date.now()}`
                : `${proxy}${encodeURIComponent(rawUrl)}`;
            const resp = await fetch(finalUrl, { mode: 'cors', credentials: 'omit' });
            let text = await resp.text();
            // 旧版 kuwo API 返回单引号 dict，转换为标准 JSON
            text = text.replace(/'/g, '"');
            const data = JSON.parse(text);
            const list = data?.abslist;
            if (!list || !Array.isArray(list) || list.length === 0) continue;
            const songs: Song[] = list.map((s: any) => {
                const rid = String(s.MUSICRID || '').replace('MUSIC_', '');
                return {
                    id: rid || String(s.DC_TARGETID || Math.random()),
                    // 旧版 API 的歌名含 &nbsp; HTML 实体，需清理
                    name: (s.SONGNAME || s.NAME || '').replace(/&nbsp;/g, ' ').trim(),
                    artist: (s.ARTIST || '').replace(/&nbsp;/g, ' ').trim(),
                    album: (s.ALBUM || '').replace(/&nbsp;/g, ' ').trim(),
                    pic: '',
                    source: 'kuwo'
                };
            });
            // 旧版 API 无封面，通过 artistpicserver 批量补全
            return batchFetchKuwoCovers(songs);
        } catch { /* 继续下一个代理 */ }
    }
    return [];
};

/** 酷我榜单列表备用：硬编码常用榜单 + kbangserver 端点 */
const KUWO_POPULAR_CHARTS = [
    { id: '93', name: '酷我飙升榜', pic: '' },
    { id: '17', name: '酷我新歌榜', pic: '' },
    { id: '16', name: '酷我热歌榜', pic: '' },
    { id: '158', name: '抖音热歌榜', pic: '' },
    { id: '284', name: 'Billboard榜', pic: '' },
    { id: '264', name: '酷我民谣榜', pic: '' },
    { id: '145', name: '会员畅听榜', pic: '' },
];

const kuwoToplistsFallback = async (): Promise<TopList[]> => {
    // 尝试从 kbangserver 获取第一个榜单的图片信息
    try {
        const data = await proxyFetchJson('http://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&type=bang&data=content&id=93&pn=0&rn=1');
        if (data?.pic) {
            KUWO_POPULAR_CHARTS[0].pic = data.pic;
        }
    } catch { /* 忽略 */ }
    return KUWO_POPULAR_CHARTS.map(c => ({
        id: c.id,
        name: c.name,
        updateFrequency: '每日更新',
        picUrl: fixUrl(c.pic),
        coverImgUrl: fixUrl(c.pic)
    }));
};

/** 酷我榜单详情备用：kbangserver.kuwo.cn */
const kuwoToplistDetailFallback = async (id: string | number): Promise<Song[]> => {
    const data = await proxyFetchJson(`http://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&pn=0&rn=30&type=bang&data=content&id=${id}`);
    const list = data?.musiclist;
    if (!list || !Array.isArray(list)) return [];
    const songs: Song[] = list.map((s: any) => ({
        id: String(s.id || ''),
        name: s.name || '',
        artist: s.artist || '',
        album: s.album || '',
        pic: '',
        source: 'kuwo'
    }));
    // kbangserver 不返回封面，通过 artistpicserver 批量补全
    return batchFetchKuwoCovers(songs);
};

export const searchSongs = async (keyword: string, platform: string, page: number = 1): Promise<Song[]> => {
    // page 传 1-indexed，让 API 模板自行转换（如 kuwo 的 {{(page || 1) - 1}}）
    // limit 变量供模板 {{limit || 20}} 使用
    const data: any = await executeMethod(platform, 'search', {
        keyword,
        page: String(page),
        limit: '30'
    });
    const results = normalizeSongs(extractList(data), platform);

    // 网易云备用：当 TuneHub method 返回空（加密/反爬）时回退到 cloudsearch
    if (results.length === 0 && platform === 'netease') {
        console.log('[Fallback] 网易云搜索使用 cloudsearch/pc 备用接口');
        return neteaseSearchFallback(keyword, page, 30);
    }
    // QQ 备用：当 TuneHub method 返回空（服务端封锁）时使用 ct=23 小程序接口
    if (results.length === 0 && platform === 'qq') {
        console.log('[Fallback] QQ 搜索使用 ct=11 移动客户端备用接口');
        return qqSearchFallback(keyword, page, 30);
    }
    // 酷我备用：当 TuneHub method 返回空时使用旧版 search.kuwo.cn
    if (results.length === 0 && platform === 'kuwo') {
        console.log('[Fallback] 酷我搜索使用 search.kuwo.cn 备用接口');
        return kuwoSearchFallback(keyword, page, 30);
    }
    // 酷我搜索结果普遍缺少封面，通过 artistpicserver 批量补全
    if (platform === 'kuwo' && results.length > 0 && results.some(s => !s.pic)) {
        return batchFetchKuwoCovers(results);
    }
    return results;
};

export const searchAggregate = async (keyword: string, page: number = 1): Promise<Song[]> => {
    const platforms = ['netease', 'qq', 'kuwo'];
    const results = await Promise.all(platforms.map(p => searchSongs(keyword, p, page).catch(() => [])));
    const merged: Song[] = [];
    const max = Math.max(...results.map(r => r.length));
    for (let i = 0; i < max; i++) {
        for (let j = 0; j < results.length; j++) {
            if (results[j][i]) merged.push(results[j][i]);
        }
    }
    return merged;
};

export const getTopLists = async (platform: string): Promise<TopList[]> => {
    const data: any = await executeMethod(platform, 'toplists');
    const rawList = extractList(data);

    // 映射所有可能的字段，修复封面丢失问题
    const results = rawList.map((item: any) => ({
        ...item,
        // QQ 使用 topId, 网易/酷我使用 id
        id: findId(item, platform),
        name: item.name || item.topTitle || item.group_name || item.title || item.intro,
        updateFrequency: item.updateFrequency || item.update_key || item.period,
        // 穷举所有可能的图片字段
        picUrl: fixUrl(findImage(item)),
        coverImgUrl: fixUrl(findImage(item))
    }));

    // 网易云备用：当 TuneHub method 返回空（-447 反爬）时回退
    if (results.length === 0 && platform === 'netease') {
        console.log('[Fallback] 网易云榜单列表使用 toplist/detail 备用接口');
        return neteaseToplistsFallback();
    }

    // 酷我备用
    if (results.length === 0 && platform === 'kuwo') {
        console.log('[Fallback] 酷我榜单列表使用硬编码 + kbangserver 备用接口');
        return kuwoToplistsFallback();
    }
    return results;
};

export const getTopListDetail = async (id: string | number, platform: string): Promise<Song[]> => {
    const data: any = await executeMethod(platform, 'toplist', { id: String(id) });
    const results = normalizeSongs(extractList(data), platform);

    // 网易云备用：当 TuneHub method 返回空（-447 反爬）时回退到 v6/playlist/detail
    if (results.length === 0 && platform === 'netease') {
        console.log('[Fallback] 网易云榜单详情使用 v6/playlist/detail 备用接口');
        return neteaseToplistDetailFallback(id);
    }
    // 酷我备用
    if (results.length === 0 && platform === 'kuwo') {
        console.log('[Fallback] 酷我榜单详情使用 kbangserver 备用接口');
        return kuwoToplistDetailFallback(id);
    }
    // 酷我歌曲普遍缺少封面，通过 artistpicserver 批量补全
    if (platform === 'kuwo' && results.length > 0 && results.some(s => !s.pic)) {
        return batchFetchKuwoCovers(results);
    }
    return results;
};

export const getPlaylistDetail = async (id: string, platform: string): Promise<{name: string, songs: Song[]} | null> => {
    const data: any = await executeMethod(platform, 'playlist', { id });
    if (!data) return null;
    
    const name = data.name || data.info?.name || data.playlist?.name || data.data?.name || data.result?.name || "未知歌单";
    
    return {
        name: String(name),
        songs: normalizeSongs(extractList(data), platform)
    };
};

export const triggerDownload = (url: string, filename: string) => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};