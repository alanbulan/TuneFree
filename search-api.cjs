const requestWithTimeout = async (url, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    let fetchOptions = {
        method: options.method || 'GET',
        headers: options.headers || {},
        signal: controller.signal
    };

    try {
        const res = await fetch(url, fetchOptions);
        let body;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('json')) {
            body = await res.json();
        } else {
            body = await res.text();
            try { body = JSON.parse(body); } catch(e) {}
        }
        
        return {
            statusCode: res.status,
            body: body
        };
    } finally {
        clearTimeout(timeout);
    }
};

// ==========================================
// 1. 网易云音乐 (Netease) - 搜索与详情
// ==========================================
const NeteaseAPI = {
    // 搜索歌曲
    async search(keyword, page = 1, limit = 10) {
        const offset = (page - 1) * limit;
        // 网易云公开的未加密 Web 接口
        const url = `http://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&offset=${offset}&total=true&limit=${limit}`;
        
        const resp = await requestWithTimeout(url);
        if (!resp.body || !resp.body.result || !resp.body.result.songs) {
            return [];
        }

        return resp.body.result.songs.map(song => ({
            id: song.id, // 这个就是 songmid
            name: song.name,
            artist: song.artists.map(a => a.name).join(', '),
            album: song.album.name,
            duration: song.duration,
            platform: 'netease'
        }));
    },

    // 获取歌词
    async getLyric(songId) {
        const url = `http://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`;
        const resp = await requestWithTimeout(url);
        return {
            lyric: resp.body?.lrc?.lyric || "",
            tlyric: resp.body?.tlyric?.lyric || ""
        };
    },

    // 获取歌曲详情 (封面等)
    async getDetails(songId) {
        const url = `http://music.163.com/api/song/detail/?id=${songId}&ids=[${songId}]`;
        const resp = await requestWithTimeout(url);
        const songInfo = resp.body?.songs?.[0];
        if (!songInfo) return null;
        
        return {
            name: songInfo.name,
            pic: songInfo.album.picUrl,
            artist: songInfo.artists.map(a => a.name).join(', ')
        };
    }
};

// ==========================================
// 2. 企鹅/QQ音乐 (Tencent) - 搜索与详情
// ==========================================
const TencentAPI = {
    // 搜索歌曲
    async search(keyword, page = 1, limit = 10) {
        // QQ 音乐轻量级公开接口
        const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=${page}&n=${limit}&w=${encodeURIComponent(keyword)}&format=json`;
        
        const resp = await requestWithTimeout(url, {
            headers: {
                'Referer': 'https://y.qq.com/portal/search.html',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!resp.body || !resp.body.data || !resp.body.data.song) {
            return [];
        }

        return resp.body.data.song.list.map(song => ({
            id: song.songmid, // 这个是 QQ 的 songmid
            name: song.songname,
            artist: song.singer.map(s => s.name).join(', '),
            album: song.albumname,
            duration: song.interval * 1000,
            platform: 'tencent'
        }));
    },

    // 获取歌词
    async getLyric(songmid) {
        const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${songmid}&format=json&nobase64=1`;
        const resp = await requestWithTimeout(url, {
            headers: {
                'Referer': 'https://y.qq.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        return {
            lyric: resp.body?.lyric || ""
        };
    }
};

module.exports = {
    NeteaseAPI,
    TencentAPI
};

// =============== 本地测试 (按需开启) ===============
if (require.main === module) {
    (async () => {
        console.log("=== 测试网易云搜索 ===");
        const wyRes = await NeteaseAPI.search("陈奕迅", 1, 2);
        console.log(wyRes);
        
        console.log("\n=== 测试 QQ 音乐搜索 ===");
        const qqRes = await TencentAPI.search("陈奕迅", 1, 2);
        console.log(qqRes);
        
        if (wyRes.length > 0) {
            console.log(`\n=== 测试网易云详情 [${wyRes[0].name}] ===`);
            const details = await NeteaseAPI.getDetails(wyRes[0].id);
            console.log(details);
        }
    })();
}
