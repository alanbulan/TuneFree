import assert from 'node:assert/strict';
import { after, afterEach, before, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { onRequest } from '../functions/api/url.ts';

let server;
let qq;
let resolver;
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

before(async () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, value: { getItem: () => null },
  });
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: false,
    server: { middlewareMode: true },
    appType: 'custom',
  });
  qq = await server.ssrLoadModule('/services/qq.ts');
  resolver = await server.ssrLoadModule('/services/resolver.ts');
});

afterEach(() => mock.restoreAll());
after(async () => {
  await server?.close();
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else delete globalThis.localStorage;
});

const resolve = (quality = '128k') => onRequest({
  request: new Request(`https://pwa.test/api/url?platform=qq&id=003h45Yk3yWjLk&quality=${quality}`),
});
const vkeyResponse = (item, sip = ['http://ws.stream.qqmusic.qq.com/']) => ({
  code: 0, queryvkey: { code: 0, data: { midurlinfo: [item], sip } },
});

test('QQ 播放请求携带 Web 客户端信息，并使用上游规范化的媒体路径', async () => {
  const request = mock.method(globalThis, 'fetch', async (url) => {
    const data = JSON.parse(new URL(url).searchParams.get('data'));
    assert.deepEqual(data.comm, { ct: 24, cv: 0 });
    assert.deepEqual(data.queryvkey.param.songmid, ['003h45Yk3yWjLk']);
    return Response.json(vkeyResponse({ result: 0, purl: 'M5000010QhHr2koVyc.mp3?vkey=test' }));
  });
  const response = await resolve();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, 'http://ws.stream.qqmusic.qq.com/M5000010QhHr2koVyc.mp3?vkey=test');
  assert.equal(request.mock.calls.length, 1);
});

test('QQ 保留所选音质，不在修复参数时改为默认 M4A', async () => {
  const filenames = [];
  mock.method(globalThis, 'fetch', async (url) => {
    filenames.push(JSON.parse(new URL(url).searchParams.get('data')).queryvkey.param.filename[0]);
    return Response.json(vkeyResponse({ result: 0, purl: 'https://ws.stream.qqmusic.qq.com/audio.mp3' }, []));
  });
  for (const quality of ['128k', '320k', 'flac', 'flac24bit']) assert.equal((await resolve(quality)).status, 200);
  assert.deepEqual(filenames.map(name => name.slice(0, 4)), ['M500', 'M800', 'F000', 'F000']);
});

test('QQ 的 104003 保留为上游拒绝，不被笼统归为 VIP', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json(vkeyResponse({ result: 104003, purl: '' })));
  const response = await resolve();
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.url, null);
  assert.equal(data.reason, 'unavailable');
  assert.equal(data.upstreamCode, 104003);
  assert.match(data.message, /104003/);
});

test('QQ 网关、vkey 业务错误和损坏响应分别保留诊断', async () => {
  const cases = [
    [{ code: 1000 }, /网关.*1000/],
    [{ code: 0, queryvkey: { code: 2001 } }, /解析请求.*2001/],
    [{}, /缺少业务状态/],
    [{ code: 0 }, /缺少 vkey 状态/],
    [{ code: 0, queryvkey: { code: 0, data: {} } }, /缺少曲目解析结果/],
    [vkeyResponse({ result: 0, purl: 'file:///audio.mp3' }), /播放地址无效/],
  ];
  let fixture;
  mock.method(globalThis, 'fetch', async () => Response.json(fixture));
  for (const [body, message] of cases) {
    fixture = body;
    const response = await resolve();
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, message);
  }
});

test('QQ 正常空地址与 HTTP 失败不同', async () => {
  const request = mock.method(globalThis, 'fetch', async () => Response.json(vkeyResponse({ result: 0, purl: '' })));
  assert.deepEqual(await (await resolve()).json(), {
    url: null, reason: 'unavailable', message: 'QQ 音乐未返回所选音质的播放地址',
  });
  request.mock.mockImplementation(async () => new Response('', { status: 403 }));
  const rejected = await resolve();
  assert.equal(rejected.status, 502);
  assert.match((await rejected.json()).error, /HTTP 403/);
});

test('QQ 搜索使用可用的官方 JSON 接口，保留分页与歌曲身份', async () => {
  const requests = [];
  mock.method(globalThis, 'fetch', async (url) => {
    requests.push(new URL(new URL(url, 'https://pwa.test').searchParams.get('url')));
    return Response.json({ code: 0, data: { song: { list: [{
      mid: 'song-mid', id: 42, name: '歌曲', singer: [{ name: '歌手' }], album: { name: '专辑', mid: 'album-mid' },
    }] } } });
  });
  const [song] = await qq.searchQQ('测试 & 音乐', 2, 20);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].hostname, 'c.y.qq.com');
  assert.equal(requests[0].pathname, '/soso/fcgi-bin/client_search_cp');
  assert.equal(requests[0].searchParams.get('w'), '测试 & 音乐');
  assert.equal(requests[0].searchParams.get('p'), '2');
  assert.equal(requests[0].searchParams.get('n'), '20');
  assert.equal(song.id, 'song-mid');
  assert.equal(song.lyricId, '42');
  assert.equal(song.artist, '歌手');
  assert.equal(song.source, 'qq');
  assert.match(song.pic, /album-mid/);
});

test('QQ 搜索区分零结果、业务拒绝及响应格式错误', async () => {
  let fixture = { code: 0, data: { song: { totalnum: 0 } } };
  mock.method(globalThis, 'fetch', async () => Response.json(fixture));
  assert.deepEqual(await qq.searchQQ('空', 1, 20), []);
  fixture = { code: 2001 };
  await assert.rejects(qq.searchQQ('拒绝', 1, 20), /2001/);
  fixture = { code: 0, data: {} };
  await assert.rejects(qq.searchQQ('错误', 1, 20), /响应不可用/);
});

test('QQ 的播放和歌词直接走原生链路，tencent 别名同样生效', async () => {
  const requests = [];
  mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url));
    const parsed = new URL(url, 'https://pwa.test');
    if (parsed.pathname === '/api/url') {
      assert.equal(parsed.searchParams.get('platform'), 'qq');
      return Response.json({ url: 'http://ws.stream.qqmusic.qq.com/native.mp3' });
    }
    assert.equal(new URL(parsed.searchParams.get('url')).hostname, 'u.y.qq.com');
    return Response.json({ code: 0, req: { code: 0, data: { lyric: Buffer.from('[00:00.00]歌词').toString('base64') } } });
  });
  assert.equal(await resolver.getSongUrl('qa-url', 'tencent'), 'https://ws.stream.qqmusic.qq.com/native.mp3');
  const full = await resolver.parseSongFull('qa-full', 'qq', '128k');
  assert.equal(full.url, 'https://ws.stream.qqmusic.qq.com/native.mp3');
  assert.match(full.lrc, /歌词/);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(url => !url.includes('gdstudio')));
});

test('原生解析的具体失败原因保留在诊断中', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ url: null, reason: 'unavailable', message: 'QQ 音乐未提供播放地址（业务码 104003）' }));
  const warning = mock.method(console, 'warn', () => {});
  assert.equal(await resolver.fetchNativeUrl('qa-error', 'qq', '128k'), null);
  assert.match(warning.mock.calls[0].arguments.join(' '), /104003/);
});

test('其他原生平台仍可通过 GD 解析', async () => {
  mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(new URL(url).hostname, 'music-api.gdstudio.xyz');
    return Response.json({ url: 'https://audio.test/netease.mp3' });
  });
  assert.equal(await resolver.getSongUrl('qa-netease', 'netease'), 'https://audio.test/netease.mp3');
});
