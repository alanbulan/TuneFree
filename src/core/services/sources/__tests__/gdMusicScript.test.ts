import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GD_MUSIC_SCRIPT } from '../builtin/gdMusicScript';
import { BUILTIN_SCRIPTS } from '../builtin/builtinScripts';
import { buildRuntimeSource } from '../runtime/runtimeSource';
import { createLxProvider } from '../lxProvider';
import { toAppPlatform } from '../platformMap';
import { parseScriptMeta } from '../scriptMeta';
import type { HostToSandboxMessage, LxSourceDeclaration, SandboxToHostMessage, SourceProxyEnvelope, SourceProxyPayload } from '../protocol';
import type { LxSandbox } from '../workerHost';

const envelope = (body: unknown, status = 200): SourceProxyEnvelope => ({
  status, statusText: status === 200 ? 'OK' : 'Error', headers: {},
  bodyBase64: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64'),
});
const formOf = (payload: SourceProxyPayload) =>
  new URLSearchParams(Buffer.from(payload.bodyBase64, 'base64').toString('utf8'));

/** 运行真实 Worker 片段与内置脚本，只替换 HTTP 上游。 */
const createHarness = (upstream: (payload: SourceProxyPayload) => SourceProxyEnvelope | Promise<SourceProxyEnvelope>) => {
  const requests: SourceProxyPayload[] = [];
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let receive!: (event: { data: HostToSandboxMessage }) => void;
  let sources: Record<string, LxSourceDeclaration> = {};
  let seq = 0;
  const send = (data: HostToSandboxMessage) => receive({ data });
  const context = createContext({
    console: { log() {}, info() {}, warn() {}, error() {} },
    TextEncoder, TextDecoder, atob, btoa, crypto: globalThis.crypto, Date,
    addEventListener: (type: string, listener: typeof receive) => { if (type === 'message') receive = listener; },
    postMessage: (message: SandboxToHostMessage) => {
      if (message.kind === 'send' && message.event === 'inited') {
        sources = (message.data as { sources: typeof sources }).sources;
      } else if (message.kind === 'request') {
        requests.push(message.payload);
        void Promise.resolve().then(() => upstream(message.payload)).then(
          (response) => send({ kind: 'reply', callId: message.callId, envelope: response }),
          (error) => send({ kind: 'reply', callId: message.callId, error: String(error) }),
        );
      } else if (message.kind === 'invoke-result' || message.kind === 'invoke-error') {
        const entry = pending.get(message.callId);
        pending.delete(message.callId);
        if (message.kind === 'invoke-error') entry?.reject(new Error(message.message));
        else entry?.resolve(message.result);
      }
    },
  });
  runInContext(buildRuntimeSource({ appVersion: '1.1.31' }), context);
  runInContext(GD_MUSIC_SCRIPT, context);
  const invoke = (source: string, action: string, info: Record<string, unknown> = {}): Promise<unknown> => {
    const callId = `test-${++seq}`;
    return new Promise((resolve, reject) => {
      pending.set(callId, { resolve, reject });
      send({ kind: 'invoke', callId, event: 'request', payload: { source, action, info } });
    });
  };
  const provider = (source: string) => createLxProvider({
    ...BUILTIN_SCRIPTS[0], scriptId: 'builtin:gd', scriptName: 'GD音乐台',
    lxPlatform: source, appPlatform: toAppPlatform(source)!, declaration: sources[source], nameMatchFallback: false,
    sandbox: { call: async (platform: string, action: string, info: Record<string, unknown>) =>
      ({ ok: true, result: await invoke(platform, action, info), error: '' }) } as unknown as LxSandbox,
  });
  return { requests, invoke, sources, provider };
};

const timedUpstream = (body: unknown) => (payload: SourceProxyPayload) =>
  envelope(payload.url.endsWith('/time') ? '1789380000' : body);

afterEach(() => vi.restoreAllMocks());

describe('GD 内置脚本与真实 LX 运行时', () => {
  it('沿用 v1.1.31 的五个平台与 GD 作者归属，只有 JOOX 与 B 站提供 GD 搜索', () => {
    const { sources } = createHarness(timedUpstream({}));
    expect(Object.keys(sources)).toEqual(['wy', 'tx', 'kw', 'joox', 'bilibili']);
    expect(Object.keys(sources).filter((key) => sources[key].actions?.includes('search'))).toEqual(['joox', 'bilibili']);
    expect(parseScriptMeta(GD_MUSIC_SCRIPT, 'gd.js')).toMatchObject({
      author: 'GD Studio', homepage: 'https://music.gdstudio.xyz/',
    });
  });

  it.each([
    ['wy', 'netease'], ['tx', 'tencent'], ['kw', 'kuwo'], ['joox', 'joox'], ['bilibili', 'bilibili'],
  ])('%s 的平台与音质请求参数兼容旧版', async (source, apiSource) => {
    const harness = createHarness(timedUpstream({ url: 'https://cdn.test/song.mp3' }));
    for (const [quality, bitrate] of [['128k', '128'], ['320k', '320'], ['flac', '740'], ['flac24bit', '999']]) {
      await harness.provider(source).getUrl!({ platform: toAppPlatform(source)!, id: '123', quality });
      const request = harness.requests[harness.requests.length - 1];
      expect(request.method).toBe('POST');
      expect(Object.fromEntries(formOf(request))).toMatchObject({
        types: 'url', source: apiSource, id: '123', br: bitrate,
      });
    }
  });

  it('按服务器时间签名，URL/歌词使用各自标识，QQ 映射为 tencent', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1780000000000);
    const harness = createHarness((payload) => {
      if (payload.url.endsWith('/time')) return envelope('1789380000');
      return envelope(formOf(payload).get('types') === 'lyric' ? { lyric: '[00:01]歌词' } : { url: 'https://cdn.test/song.mp3' });
    });
    const musicInfo = { id: 'song-id', urlId: 'url-id', lyricId: 'lyric-id' };
    await Promise.all([
      harness.invoke('tx', 'musicUrl', { type: 'flac', musicInfo }),
      harness.invoke('tx', 'lyric', { musicInfo }),
    ]);
    expect(harness.requests.filter((request) => request.url.endsWith('/time'))).toHaveLength(1);
    const forms = harness.requests.filter((request) => request.method === 'POST').map(formOf);
    expect(forms.map((form) => form.get('id')).sort()).toEqual(['lyric-id', 'url-id']);
    for (const form of forms) {
      const expected = createHash('md5').update(`178938000|music.gdstudio.org|20260616|${form.get('id')}`).digest('hex').slice(-8).toUpperCase();
      expect(form.get('s')).toBe(expected);
      expect(form.get('source')).toBe('tencent');
    }
    expect(forms.find((form) => form.get('types') === 'url')?.get('br')).toBe('740');
  });

  it.each(['qrc', 'yrc', 'krc', 'klyric', 'mrc', 'karaoke'])('保留 %s 逐字轨、翻译、罗马音和发音轨', async (field) => {
    const harness = createHarness(timedUpstream({
      lrc: '[00:01]歌曲', tlyric: '[00:01]翻译一', trans: '[00:01]翻译二',
      romanization: '[00:01]roman', pronunciation: '[00:01]读音', [field]: '[1000,1000]歌(0,1000)',
    }));
    const lyric = await harness.provider('wy').getLyrics!({ platform: 'netease', id: '123', quality: '320k' });
    expect(lyric).toContain('[tunefree:karaoke]\n[1000,1000]歌(0,1000)');
    expect(lyric).toContain('[tunefree:romanization]\n[00:01]roman');
    expect(lyric).toContain('[tunefree:pronunciation]\n[00:01]读音');
    expect(lyric).toContain('翻译一\n[00:01]翻译二');
    expect(harness.requests.filter((request) => request.method === 'POST').map(formOf).map((form) => form.get('types'))).toEqual(['lyric']);
  });

  it('从原始字节解码 GB18030，避免运行时 UTF-8 预解码造成歌词乱码', async () => {
    const raw = Buffer.concat([Buffer.from('{"lyric":"[00:01]'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), Buffer.from('"}')]);
    const harness = createHarness((payload) => payload.url.endsWith('/time')
      ? envelope('1789380000') : { ...envelope(''), bodyBase64: raw.toString('base64') });
    expect(await harness.provider('wy').getLyrics!({ platform: 'netease', id: '123', quality: '320k' })).toBe('[00:01]中文');
  });

  it('封面直链、QQ 与 JOOX 模板不请求 GD；没有 picId 时不误用歌曲 ID', async () => {
    const harness = createHarness(timedUpstream({}));
    expect(await harness.invoke('kw', 'pic', { musicInfo: { picId: 'https://img.test/cover.jpg' } })).toBe('https://img.test/cover.jpg');
    expect(await harness.invoke('tx', 'pic', { musicInfo: { id: 'song', picId: 'album' } })).toBe('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg');
    expect(await harness.invoke('joox', 'pic', { musicInfo: { picId: 'cover' } })).toBe('https://image.joox.com/JOOXcover/0/cover/500');
    expect(await harness.invoke('tx', 'pic', { musicInfo: { id: 'song' } })).toBeNull();
    expect(harness.requests).toHaveLength(0);
  });

  it('网易封面查询使用歌曲 ID；原生失败后再用 picId 请求 GD', async () => {
    let nativeOk = true;
    const harness = createHarness((payload) => {
      if (payload.url.includes('music.163.com')) return nativeOk
        ? envelope({ songs: [{ album: { picUrl: 'https://img.test/native.jpg' } }] }) : envelope({}, 500);
      return timedUpstream({ url: 'https://img.test/gd.jpg' })(payload);
    });
    const info = { musicInfo: { id: '123', picId: '456' } };
    expect(await harness.invoke('wy', 'pic', info)).toBe('https://img.test/native.jpg');
    expect(new URL(harness.requests[0].url).searchParams.get('id')).toBe('123');
    expect(new URL(harness.requests[0].url).searchParams.get('ids')).toBe('[123]');
    expect(harness.requests).toHaveLength(1);
    nativeOk = false;
    expect(await harness.invoke('wy', 'pic', info)).toBe('https://img.test/gd.jpg');
    const picForm = formOf(harness.requests[harness.requests.length - 1]);
    expect(picForm.get('types')).toBe('pic');
    expect(picForm.get('id')).toBe('456');
  });

  it('搜索保留独立 URL、歌词、封面 ID，拒绝错误平台的响应', async () => {
    const track = { id: 1, name: '歌曲', artist: ['歌手'], album: '专辑',
      url_id: 2, lyric_id: 3, pic_id: 'cover', source: 'joox' };
    const harness = createHarness(timedUpstream([track]));
    expect(await harness.provider('joox').search!('歌曲', 'joox', 2, 10)).toEqual([{
      id: '1', name: '歌曲', artist: '歌手', album: '专辑', urlId: '2', lyricId: '3',
      picId: 'cover', pic: 'https://image.joox.com/JOOXcover/0/cover/500', source: 'joox',
    }]);
    const form = formOf(harness.requests[harness.requests.length - 1]);
    expect(form.get('pages')).toBe('2');
    expect(form.get('count')).toBe('10');
    track.source = 'netease';
    await expect(harness.invoke('joox', 'search', { keyword: '歌曲' })).rejects.toThrow('平台与请求不一致');
  });

  it('兼容缺失、空白或废弃的 url_id，恢复旧版搜索去重且不把 null 当作歌曲 ID', async () => {
    const track = { id: 'track-id', name: '歌曲', artist: ['歌手'], album: '', source: 'joox' };
    const harness = createHarness(timedUpstream([
      track, track,
      { ...track, id: 'second-id', url_id: null, lyric_id: ' ' },
      { ...track, id: null },
    ]));
    const songs = await harness.provider('joox').search!('歌曲', 'joox', 1, 20);
    expect(songs.map(({ id, urlId, lyricId }) => ({ id, urlId, lyricId }))).toEqual([
      { id: 'track-id', urlId: 'track-id', lyricId: 'track-id' },
      { id: 'second-id', urlId: 'second-id', lyricId: 'second-id' },
    ]);
  });

  it('HTTP 失败和接口错误都结束调用', async () => {
    const httpFailure = createHarness((payload) => payload.url.endsWith('/time')
      ? envelope('1789380000') : envelope('Unavailable', 503));
    await expect(httpFailure.invoke('wy', 'musicUrl', { musicInfo: { id: '123' } })).rejects.toThrow('HTTP 503');
    const apiFailure = createHarness(timedUpstream({ error: 'rate limit' }));
    await expect(apiFailure.invoke('wy', 'musicUrl', { musicInfo: { id: '123' } })).rejects.toThrow('rate limit');
    const unsupported = createHarness((payload) => payload.url.endsWith('/time')
      ? envelope('1789380000') : envelope({ detail: 'Value of `source` is not supported.' }, 400));
    await expect(unsupported.invoke('tx', 'musicUrl', { musicInfo: { id: '123' } }))
      .rejects.toThrow('GD 公开接口目前不支持该平台（tencent）');
  });
});
