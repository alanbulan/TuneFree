/**
 * 内置音源脚本：GD 音乐台。
 *
 * 这是 TuneFree 自带的「内置脚本」，与用户导入的洛雪脚本走**完全相同**的运行时
 * 与协议，因此平台能力不再是散落在 TS 里的硬编码分支。
 *
 * 与洛雪协议的差异只有一处扩展：脚本可以声明并实现 `search` action
 * （洛雪本身没有搜索），搜索结果的字段形如：
 * `{ id, name, artist, album, pic?, picId?, urlId?, lyricId?, source? }`。
 *
 * 沿用原来的 TS 客户端协议：先同步服务器时间，按
 * `md5(时间戳前9位 | music.gdstudio.org | 20260616 | 主题)` 取后 8 位作为 `s` 签名，
 * 表单 POST 到 `api.php`。
 */
export const GD_MUSIC_SCRIPT = String.raw`
/**
 * @name GD音乐台
 * @description GD音乐台（music.gdstudio.xyz）公开接口
 * @version 1.0.0
 * @author GD Studio
 * @homepage https://music.gdstudio.xyz/
 */

const { EVENT_NAMES, request, on, send, utils } = globalThis.lx;

const API_URL = 'https://music-api.gdstudio.xyz/api.php';
const TIME_URL = 'https://music-api.gdstudio.xyz/time';
const SIGN_HOST = 'music.gdstudio.org';
const SIGN_SALT = '20260616';
const REQUEST_TIMEOUT = 12000;

const BITRATE = { '128k': '128', '320k': '320', flac: '740', flac24bit: '999' };
// 这里声明可发送的音质参数，实际音质由 GD 接口返回，不代表所有平台都提供无损。
const QUALITYS = ['128k', '320k', 'flac', 'flac24bit'];
// 与 v1.1.31 的 GD 链路保持一致；酷狗、咪咕不属于该接口的既有支持范围。
const PLATFORM_NAMES = {
  wy: '网易云音乐', tx: 'QQ音乐', kw: '酷我音乐', joox: 'JOOX', bilibili: '哔哩哔哩',
};
const API_SOURCE = {
  wy: 'netease', tx: 'tencent', kw: 'kuwo', joox: 'joox', bilibili: 'bilibili',
};

let timeDiff = 0;
let timeSynced = false;
let timeSyncPromise = null;

const httpGet = (url) => new Promise((resolve, reject) => {
  request(url, { method: 'GET', timeout: REQUEST_TIMEOUT }, (error, response) => {
    if (error) return reject(error);
    resolve(response);
  });
});

const httpForm = (url, form) => new Promise((resolve, reject) => {
  request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    form,
    timeout: REQUEST_TIMEOUT,
  }, (error, response) => {
    if (error) return reject(error);
    resolve(response);
  });
});

const decodeBody = (response) => {
  if (!response) throw new Error('GD 接口无响应');
  let body = response.body;
  if (response.raw && response.raw.length) {
    const bytes = new Uint8Array(response.raw);
    const utf8 = new TextDecoder('utf-8').decode(bytes);
    body = utf8;
    try {
      const gb18030 = new TextDecoder('gb18030').decode(bytes);
      const artifacts = (text) => (text.match(/�/g) || []).length;
      if (artifacts(gb18030) < artifacts(utf8)) body = gb18030;
    } catch (error) { /* 不支持 GB18030 时保留 UTF-8 */ }
  }
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (/^[{[]/.test(trimmed)) {
      try { return JSON.parse(trimmed); } catch (error) { /* 保留原文 */ }
    }
    return trimmed;
  }
  return body;
};

const syncTime = async () => {
  if (timeSynced) return;
  if (!timeSyncPromise) {
    timeSyncPromise = (async () => {
      const started = Date.now();
      try {
        const response = await httpGet(TIME_URL);
        const serverTime = Number(String(decodeBody(response)).trim());
        if (response.statusCode < 400 && isFinite(serverTime) && serverTime > 0) {
          timeDiff = serverTime * 1000 - (started + (Date.now() - started) / 2);
          timeSynced = true;
        }
      } catch (error) {
        // 同步失败就用本地时间
      }
    })().finally(() => { timeSyncPromise = null; });
  }
  return timeSyncPromise;
};

const urlEncode = (value) => encodeURIComponent(String(value))
  .replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');

const buildSignature = (params, timestamp) => {
  const prefix = String(timestamp).slice(0, 9);
  const subject = params.name !== undefined
    ? urlEncode(params.name)
    : urlEncode(params.id === undefined ? params.types : params.id);
  return utils.crypto.md5(prefix + '|' + SIGN_HOST + '|' + SIGN_SALT + '|' + subject);
};

const callApi = async (params) => {
  await syncTime();
  const timestamp = Date.now() + timeDiff;
  const signature = buildSignature(params, timestamp);
  const form = {};
  Object.keys(params).forEach((key) => {
    if (key === 's' || params[key] === undefined || params[key] === null) return;
    form[key] = String(params[key]);
  });
  form.s = String(params.s || signature.slice(-8).toUpperCase());

  const response = await httpForm(API_URL, form);
  const data = decodeBody(response);
  if (response.statusCode >= 400) {
    throw new Error('GD 接口 HTTP ' + response.statusCode);
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (typeof data.error === 'string' && data.error) throw new Error(data.error);
    if (typeof data.detail === 'string' && data.detail) throw new Error(data.detail);
  }
  return data;
};

const pickText = (data, fields) => {
  for (let index = 0; index < fields.length; index += 1) {
    const value = data[fields[index]];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const pickId = (info, key) => {
  const value = info[key];
  if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  return info.id === undefined || info.id === null ? '' : String(info.id).trim();
};

/* ---------------- 搜索 ---------------- */

const buildCover = (source, track) => {
  const picId = typeof track.pic_id === 'string' ? track.pic_id.trim() : '';
  if (!picId) return '';
  if (picId.indexOf('http') === 0 || picId.indexOf('//') === 0) return picId;
  if (source === 'joox') return 'https://image.joox.com/JOOXcover/0/' + picId + '/500';
  return '';
};

const normalizeTrack = (source, track) => {
  const id = pickId(track, 'id');
  const name = typeof track.name === 'string' ? track.name.trim() : '';
  if (!id || !name) return null;
  const artist = Array.isArray(track.artist) ? track.artist.join(', ') : String(track.artist || '');
  return {
    id,
    name,
    artist,
    album: typeof track.album === 'string' ? track.album : '',
    pic: buildCover(source, track),
    picId: typeof track.pic_id === 'string' ? track.pic_id.trim() : '',
    urlId: pickId(track, 'url_id'),
    lyricId: pickId(track, 'lyric_id'),
    source,
  };
};

const searchTracks = async (lxSource, info) => {
  const source = API_SOURCE[lxSource];
  const data = await callApi({
    types: 'search',
    source,
    name: info.keyword || '',
    count: info.limit || 30,
    pages: info.page || 1,
  });
  if (!Array.isArray(data)) throw new Error('GD 搜索返回格式异常');
  const songs = [];
  const seen = new Set();
  for (let index = 0; index < data.length; index += 1) {
    const track = data[index];
    if (!track || typeof track !== 'object' || Array.isArray(track)) continue;
    if (track.source !== undefined && track.source !== source) {
      throw new Error('GD 搜索结果的平台与请求不一致');
    }
    const song = normalizeTrack(source, track);
    if (song && !seen.has(song.id)) {
      seen.add(song.id);
      songs.push(song);
    }
  }
  return songs;
};

/* ---------------- 播放地址 / 歌词 / 封面 ---------------- */

const pickUrl = async (lxSource, info, quality) => {
  const data = await callApi({
    types: 'url',
    source: API_SOURCE[lxSource],
    // 兼容旧版保存的 urlId；新响应不再提供 url_id 时使用曲目 id。
    id: pickId(info, 'urlId') || pickId(info, 'songmid'),
    br: BITRATE[quality] || '320',
  });
  const url = data && typeof data.url === 'string' ? data.url.trim() : '';
  if (!url) throw new Error('GD 未返回可用音频');
  return url;
};

const fetchLyric = async (lxSource, info) => {
  const id = pickId(info, 'lyricId') || pickId(info, 'songmid');
  const data = await callApi({ types: 'lyric', source: API_SOURCE[lxSource], id });
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const main = pickText(data, ['lyric', 'lrc']);
  const tlyric = ['tlyric', 'trans', 'translation', 'translations']
    .map((key) => pickText(data, [key])).filter(Boolean).join('\n');
  const rlyric = pickText(data, ['rlyric', 'romalrc', 'roma', 'romanization']);
  const pronunciation = pickText(data, ['pronunciation']);
  const karaoke = pickText(data, ['qrc', 'yrc', 'krc', 'klyric', 'mrc', 'karaoke']);
  if (!main && !tlyric && !rlyric && !pronunciation && !karaoke) return null;
  return { lyric: main, tlyric, rlyric, pronunciation, karaoke };
};

const fetchPic = async (lxSource, info) => {
  const picId = info.picId === undefined || info.picId === null ? '' : String(info.picId).trim();
  if (!picId) return null;
  if (picId.indexOf('http') === 0 || picId.indexOf('//') === 0) return picId;
  if (lxSource === 'wy') {
    try {
      const songId = String(info.id || info.songmid || picId);
      const response = await httpGet('https://music.163.com/api/song/detail/?id=' + encodeURIComponent(songId)
        + '&ids=' + encodeURIComponent('[' + songId + ']'));
      const data = decodeBody(response);
      const pic = data && data.songs && data.songs[0] && data.songs[0].album && data.songs[0].album.picUrl;
      if (response.statusCode < 400 && typeof pic === 'string' && pic.trim()) return pic.trim();
    } catch (error) { /* 原生封面失败后继续 GD 查询 */ }
  }
  if (lxSource === 'tx') return 'https://y.gtimg.cn/music/photo_new/T002R300x300M000' + picId + '.jpg';
  if (lxSource === 'joox') return 'https://image.joox.com/JOOXcover/0/' + picId + '/500';
  try {
    const data = await callApi({ types: 'pic', source: API_SOURCE[lxSource], id: picId, size: 500 });
    const url = data && typeof data.url === 'string' ? data.url.trim() : '';
    return url || null;
  } catch (error) {
    return null;
  }
};

/* ---------------- 注册 ---------------- */

on(EVENT_NAMES.request, function (payload) {
  const source = payload.source;
  const action = payload.action;
  const info = payload.info || {};
  if (!API_SOURCE[source]) return Promise.reject(new Error('不支持的音乐源：' + source));
  const musicInfo = info.musicInfo || {};

  if (action === 'search') {
    return searchTracks(source, { keyword: info.keyword, page: info.page, limit: info.limit });
  }
  if (action === 'musicUrl') {
    return pickUrl(source, musicInfo, info.type);
  }
  if (action === 'lyric') {
    return fetchLyric(source, musicInfo);
  }
  if (action === 'pic') {
    return fetchPic(source, musicInfo);
  }
  return Promise.reject(new Error('不支持的操作：' + action));
});

const SEARCHABLE = { joox: true, bilibili: true };
const sources = {};
Object.keys(PLATFORM_NAMES).forEach((key) => {
  sources[key] = {
    name: PLATFORM_NAMES[key],
    type: 'music',
    // 只有 GD 独占平台提供搜索：其余平台的搜索由原生实现负责，避免白占 GD 频次
    actions: SEARCHABLE[key] ? ['musicUrl', 'lyric', 'pic', 'search'] : ['musicUrl', 'lyric', 'pic'],
    qualitys: QUALITYS,
  };
});

send(EVENT_NAMES.inited, { status: true, openDevTools: false, sources });
`;
