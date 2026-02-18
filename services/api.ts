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

    // 1. 修复 Kuwo 域名证书问题
    fixed = fixed.replace(/kwcdn\.kuwo\.cn/g, 'kuwo.cn');

    // 2. 移除 URL 中的换行符或空白
    fixed = fixed.trim();

    // 3. 修复协议 (仅针对明显缺失协议的)
    if (fixed.startsWith('//')) {
        fixed = `https:${fixed}`;
    }

    // 4. 强制 HTTPS (针对已知支持 HTTPS 的图床)
    if (fixed.startsWith('http://')) {
        if (
            fixed.includes('music.126.net') || 
            fixed.includes('y.gtimg.cn') || 
            fixed.includes('qpic.cn') ||
            fixed.includes('kuwo.cn') ||
            fixed.includes('img.kwcdn.kuwo.cn')
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
    
    // QQ Specific
    if (platform === 'qq') {
        if (item.topId) return String(item.topId); 
        if (item.id) return String(item.id); 
        if (item.mid) return String(item.mid);
        if (item.songmid) return String(item.songmid);
        if (item.file?.media_mid) return String(item.file.media_mid);
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
    
    const replaceVars = (str: string) => {
        let result = str;
        for (const [key, value] of Object.entries(variables)) {
            result = result.replace(new RegExp(`{{${key}}}`, 'g'), encodeURIComponent(String(value)));
        }
        return result;
    };

    let requestUrl = replaceVars(config.url);
    if (config.params) {
        const finalParams = new URLSearchParams();
        for (const [k, v] of Object.entries(config.params)) {
            finalParams.append(k, replaceVars(v));
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
            const response = await fetch(finalFetchUrl, {
                method: config.method,
                headers: safeHeaders,
                mode: 'cors',
                credentials: 'omit'
            });
            
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
                    return transformer(rawData);
                } catch (e) {
                    console.error("Transform error", e);
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
    const data = await parseSongs(String(id), source);
    return data?.[0]?.lrc || data?.[0]?.lyric || "";
};

export const getSongUrl = async (id: string | number, source: string, quality: string = '320k'): Promise<string | null> => {
    if (!source || source === 'undefined') return null;
    const data = await parseSongs(String(id), source, quality);
    let url = data?.[0]?.url;
    return fixUrl(url) || null;
};

export const searchSongs = async (keyword: string, platform: string, page: number = 1): Promise<Song[]> => {
    const data: any = await executeMethod(platform, 'search', { 
        keyword, 
        page: String(page - 1),
        pageSize: '30'
    });
    return normalizeSongs(extractList(data), platform);
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
    return rawList.map((item: any) => ({
        ...item,
        // QQ 使用 topId, 网易/酷我使用 id
        id: findId(item, platform), 
        name: item.name || item.topTitle || item.group_name || item.title || item.intro,
        updateFrequency: item.updateFrequency || item.update_key || item.period,
        // 穷举所有可能的图片字段
        picUrl: fixUrl(findImage(item)),
        coverImgUrl: fixUrl(findImage(item))
    }));
};

export const getTopListDetail = async (id: string | number, platform: string): Promise<Song[]> => {
    const data: any = await executeMethod(platform, 'toplist', { id: String(id) });
    return normalizeSongs(extractList(data), platform);
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