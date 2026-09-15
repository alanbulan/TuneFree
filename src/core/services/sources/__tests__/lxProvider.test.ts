import { describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../__tests__/deferred';
import { createLxProvider } from '../lxProvider';
import type { LxSourceDeclaration } from '../protocol';
import type { LxSandbox, SandboxCallOutcome } from '../workerHost';

interface CallRecord {
  source: string;
  action: string;
  info: Record<string, unknown>;
}

const createSandboxStub = (
  responder: (record: CallRecord) => SandboxCallOutcome | Promise<SandboxCallOutcome>,
) => {
  const calls: CallRecord[] = [];
  const sandbox = {
    calls,
    call: vi.fn(async (source: string, action: string, info: Record<string, unknown>) => {
      const record = { source, action, info };
      calls.push(record);
      return responder(record);
    }),
  };
  return sandbox as unknown as LxSandbox & { calls: CallRecord[] };
};

const urlOutcome = (url: unknown): SandboxCallOutcome => ({ ok: true, result: url, error: '' });

const createProvider = (
  sandbox: LxSandbox,
  declaration: LxSourceDeclaration,
  overrides: { nameMatchFallback?: boolean; metadataRequiresUrl?: boolean } = {},
) =>
  createLxProvider({
    scriptId: 'script-1',
    scriptName: '测试音源',
    appPlatform: 'kuwo',
    lxPlatform: 'kw',
    declaration,
    sandbox,
    nameMatchFallback: overrides.nameMatchFallback ?? false,
    metadataRequiresUrl: overrides.metadataRequiresUrl,
  });

const request = (overrides: Record<string, unknown> = {}) => ({
  platform: 'kuwo',
  id: 7,
  quality: '320k',
  name: '歌名',
  artist: '歌手',
  album: '专辑',
  ...overrides,
});

describe('lxProvider', () => {
  it('暴露标识与平台能力', () => {
    const provider = createProvider(createSandboxStub(() => urlOutcome('u')), {});
    expect(provider.kind).toBe('lx');
    expect(provider.id).toBe('lx:script-1:kw');
    expect(provider.label).toBe('测试音源');
    expect(provider.platforms).toEqual(['kuwo']);
  });

  it('解析 URL：字符串与对象结果都认，并命中缓存', async () => {
    const sandbox = createSandboxStub((record) =>
      urlOutcome(record.info.type === 'flac' ? { url: 'https://cdn.test/flac.mp3' } : 'https://cdn.test/320.mp3'),
    );
    const provider = createProvider(sandbox, { qualitys: ['128k', '320k', 'flac'] });

    await expect(provider.getUrl!(request())).resolves.toBe('https://cdn.test/320.mp3');
    await expect(provider.getUrl!(request())).resolves.toBe('https://cdn.test/320.mp3');
    expect(sandbox.calls).toHaveLength(1);
    expect(sandbox.calls[0]).toMatchObject({
      source: 'kw',
      action: 'musicUrl',
      info: { type: '320k', musicInfo: { songmid: '7', name: '歌名', singer: '歌手' } },
    });

    // forceRefresh 重新请求。
    await provider.getUrl!(request({ forceRefresh: true, quality: 'flac' }));
    expect(sandbox.calls).toHaveLength(2);
    expect(sandbox.calls[1].info.type).toBe('flac');
  });

  it('请求音质不在声明内时按降级顺序挑选', async () => {
    const sandbox = createSandboxStub(() => urlOutcome('https://cdn.test/song.mp3'));
    const provider = createProvider(sandbox, { qualitys: ['128k', '320k'] });
    await provider.getUrl!(request({ quality: 'flac24bit' }));
    expect(sandbox.calls[0].info.type).toBe('320k');
  });

  it('声明的音质列表为空或未声明 musicUrl 时直接返回 null', async () => {
    const empty = createSandboxStub(() => urlOutcome('u'));
    expect(await createProvider(empty, { qualitys: [] }).getUrl!(request())).toBeNull();
    expect(empty.calls).toHaveLength(0);

    const noAction = createSandboxStub(() => urlOutcome('u'));
    expect(await createProvider(noAction, { actions: ['lyric'] }).getUrl!(request())).toBeNull();
    expect(noAction.calls).toHaveLength(0);
  });

  it('空值和畸形地址不能成为解析成功，脚本报错保持原原因', async () => {
    const emptyResult = createSandboxStub(() => urlOutcome(null));
    await expect(createProvider(emptyResult, {}).getUrl!(request())).rejects.toThrow('解析结果格式错误');

    const objectWithoutUrl = createSandboxStub(() => urlOutcome({ lyric: 'x' }));
    await expect(createProvider(objectWithoutUrl, {}).getUrl!(request())).rejects.toThrow('解析结果格式错误');
    for (const value of ['接口维护中', 'ftp://cdn.test/song.mp3', { url: '/relative.mp3' }]) {
      await expect(createProvider(createSandboxStub(() => urlOutcome(value)), {}).getUrl!(request()))
        .rejects.toThrow('解析结果格式错误');
    }

    const failing = createSandboxStub(() => ({ ok: false, result: null, error: '源接口 500' }));
    await expect(createProvider(failing, {}).getUrl!(request())).rejects.toThrow('源接口 500');

    const failingWithoutMessage = createSandboxStub(() => ({ ok: false, result: null, error: '' }));
    await expect(createProvider(failingWithoutMessage, {}).getUrl!(request())).rejects.toThrow('音源解析失败');
  });

  it('缺少 id 时只有开启按歌名匹配才继续', async () => {
    const sandbox = createSandboxStub(() => urlOutcome('https://cdn.test/song.mp3'));
    const strict = createProvider(sandbox, {});
    expect(await strict.getUrl!(request({ id: '' }))).toBeNull();
    expect(sandbox.calls).toHaveLength(0);

    const loose = createProvider(sandbox, {}, { nameMatchFallback: true });
    await expect(loose.getUrl!(request({ id: '' }))).resolves.toBe('https://cdn.test/song.mp3');
    expect(loose.nameMatch).toBe(true);
  });

  it('按歌名匹配的缓存区分歌名、歌手和专辑', async () => {
    const sandbox = createSandboxStub(({ info }) => {
      const meta = info.musicInfo as { name: string; singer: string; albumName: string };
      return urlOutcome(`https://cdn.test/${meta.name}/${meta.singer}/${meta.albumName}.mp3`);
    });
    const provider = createProvider(sandbox, {}, { nameMatchFallback: true });
    const inputs = [
      request({ id: '', name: '第一首' }),
      request({ id: '', name: '第二首' }),
      request({ id: '', name: '第二首', artist: '另一位歌手' }),
      request({ id: '', name: '第二首', artist: '另一位歌手', album: '现场专辑' }),
    ];
    const urls = await Promise.all(inputs.map((input) => provider.getUrl!(input)));
    for (let index = 0; index < inputs.length; index += 1) {
      await expect(provider.getUrl!(inputs[index])).resolves.toBe(urls[index]);
    }
    expect(new Set(urls).size).toBe(4);
    expect(sandbox.calls).toHaveLength(4);
  });

  it('同一调用方并发取链接、歌词和封面时只准备一次 musicUrl', async () => {
    const prepared = deferred<SandboxCallOutcome>();
    const sandbox = createSandboxStub(({ action }) =>
      action === 'musicUrl' ? prepared.promise : urlOutcome(action));
    const provider = createProvider(sandbox, { actions: ['musicUrl', 'lyric', 'pic'] });
    const controller = new AbortController();
    const input = request({ signal: controller.signal });
    const pending = Promise.all([provider.getUrl!(input), provider.getLyrics!(input), provider.getPic!(input)]);
    prepared.resolve(urlOutcome('https://cdn.test/one.mp3'));
    await pending;
    expect(sandbox.calls.filter(({ action }) => action === 'musicUrl')).toHaveLength(1);
  });

  it('歌词：声明了 lyric 时先确保 musicUrl 跑过一次', async () => {
    const sandbox = createSandboxStub((record) => {
      if (record.action === 'musicUrl') return urlOutcome('https://cdn.test/a.mp3');
      return { ok: true, result: { lyric: '[00:00]歌词', tlyric: 'translation' }, error: '' };
    });
    const provider = createProvider(sandbox, { actions: ['musicUrl', 'lyric'] });

    // 脚本返回 {lyric, tlyric} 时按应用格式合并（翻译以分段标记附着在主歌词后）
    const merged = await provider.getLyrics!(request());
    expect(merged).toContain('[00:00]歌词');
    expect(merged).toContain('translation');
    expect(sandbox.calls.map((call) => call.action)).toEqual(['musicUrl', 'lyric']);

    // 第二次调用已记录过 musicUrl，不再重复请求。
    await expect(provider.getLyrics!(request())).resolves.toContain('[00:00]歌词');
    expect(sandbox.calls.map((call) => call.action)).toEqual(['musicUrl', 'lyric', 'lyric']);
  });

  it('歌词：字符串结果、失败与未声明的情况', async () => {
    const stringLyric = createSandboxStub((record) =>
      record.action === 'lyric' ? { ok: true, result: '纯文本歌词', error: '' } : urlOutcome('u'),
    );
    expect(await createProvider(stringLyric, { actions: ['musicUrl', 'lyric'] }).getLyrics!(request())).toBe(
      '纯文本歌词',
    );

    const failing = createSandboxStub((record) =>
      record.action === 'lyric' ? { ok: false, result: null, error: '炸' } : urlOutcome('u'),
    );
    expect(await createProvider(failing, { actions: ['musicUrl', 'lyric'] }).getLyrics!(request())).toBe('');

    const unsupported = createSandboxStub(() => urlOutcome('u'));
    expect(await createProvider(unsupported, { actions: ['musicUrl'] }).getLyrics!(request())).toBe('');
    expect(unsupported.calls).toHaveLength(0);
  });

  it('内置脚本可独立补歌词与封面，不占用 musicUrl 请求', async () => {
    const sandbox = createSandboxStub(({ action }) => urlOutcome(action));
    const provider = createProvider(sandbox, { actions: ['musicUrl', 'lyric', 'pic'] }, {
      metadataRequiresUrl: false,
    });
    await Promise.all([provider.getLyrics!(request()), provider.getPic!(request())]);
    expect(sandbox.calls.map(({ action }) => action)).toEqual(['lyric', 'pic']);
  });

  it.each(['klyric', 'mrc'])('保留 %s 字段提供的逐字歌词', async (field) => {
    const sandbox = createSandboxStub(() => urlOutcome({ lyric: '[00:01]歌曲', [field]: '[1000,1000]歌(0,1000)' }));
    const provider = createProvider(sandbox, { actions: ['lyric'] });
    expect(await provider.getLyrics!(request())).toContain('[tunefree:karaoke]\n[1000,1000]歌(0,1000)');
  });

  it('歌词：musicUrl 报错不阻断歌词，但结果为空', async () => {
    const sandbox = createSandboxStub((record) =>
      record.action === 'musicUrl'
        ? { ok: false, result: null, error: '源接口 502' }
        : { ok: true, result: null, error: '' },
    );
    const provider = createProvider(sandbox, { actions: ['musicUrl', 'lyric'] });
    await expect(provider.getLyrics!(request())).resolves.toBe('');
    expect(sandbox.calls.map((call) => call.action)).toEqual(['musicUrl', 'lyric']);
  });

  it('搜索：只有声明了 search 的脚本才提供搜索，结果会被收窄成歌曲', async () => {
    const sandbox = createSandboxStub((record) =>
      record.action === 'search'
        ? {
            ok: true,
            result: [
              { id: 'S1', name: '晴天', artist: '周杰伦', album: '叶惠美', pic: 'https://img.test/a.jpg', urlId: 'u1', lyricId: 'l1' },
              { id: '', name: '缺 id 被丢弃' },
              null,
              '不是对象',
            ],
            error: '',
          }
        : urlOutcome('u'),
    );

    const withoutSearch = createProvider(sandbox, { actions: ['musicUrl'] });
    expect(withoutSearch.searchPlatforms).toBeUndefined();
    expect(withoutSearch.search).toBeUndefined();

    const provider = createProvider(sandbox, { actions: ['musicUrl', 'search'] });
    expect(provider.searchPlatforms).toEqual(['kuwo']);
    await expect(provider.search!('晴天', 'kuwo', 2, 10)).resolves.toEqual([
      {
        id: 'S1',
        name: '晴天',
        artist: '周杰伦',
        album: '叶惠美',
        pic: 'https://img.test/a.jpg',
        urlId: 'u1',
        lyricId: 'l1',
        source: 'kuwo',
      },
    ]);
    expect(sandbox.calls[0]).toEqual({ source: 'kw', action: 'search', info: { keyword: '晴天', page: 2, limit: 10 } });
  });

  it('搜索：脚本返回非数组按空结果处理，失败则抛出', async () => {
    const weird = createSandboxStub(() => ({ ok: true, result: '不是数组', error: '' }));
    await expect(createProvider(weird, { actions: ['search'] }).search!('词', 'kuwo', 1, 5)).resolves.toEqual([]);

    const failing = createSandboxStub(() => ({ ok: false, result: null, error: '搜索被限流' }));
    await expect(createProvider(failing, { actions: ['search'] }).search!('词', 'kuwo', 1, 5)).rejects.toThrow(
      '搜索被限流',
    );

    const failingWithoutMessage = createSandboxStub(() => ({ ok: false, result: null, error: '' }));
    await expect(
      createProvider(failingWithoutMessage, { actions: ['search'] }).search!('词', 'kuwo', 1, 5),
    ).rejects.toThrow('音源搜索失败');
  });

  it('内置脚本字段透传到 provider 声明（优先级 / 频次 / 兜底方式）', () => {
    const sandbox = createSandboxStub(() => urlOutcome('u'));
    const builtin = createLxProvider({
      scriptId: 'builtin:gd',
      scriptName: 'GD音乐台',
      appPlatform: 'joox',
      lxPlatform: 'joox',
      declaration: { actions: ['musicUrl', 'lyric', 'pic', 'search'] },
      sandbox,
      nameMatchFallback: false,
      priority: 10,
      lyricsPriority: 20,
      fallback: true,
      searchTier: 'extended',
      gdStudioQuota: true,
    });
    expect(builtin).toMatchObject({
      priority: 10,
      lyricsPriority: 20,
      fallback: true,
      searchTier: 'extended',
      gdStudioQuota: true,
      searchPlatforms: ['joox'],
    });

    const plain = createProvider(createSandboxStub(() => urlOutcome('u')), {});
    expect(plain.priority).toBeUndefined();
    expect(plain.gdStudioQuota).toBeUndefined();
    expect(plain.fallback).toBeUndefined();
    expect(plain.searchTier).toBeUndefined();
  });

  it('封面：声明了 pic 时返回地址', async () => {
    const sandbox = createSandboxStub((record) =>
      record.action === 'pic' ? { ok: true, result: 'https://img.test/cover.jpg', error: '' } : urlOutcome('u'),
    );
    const provider = createProvider(sandbox, { actions: ['musicUrl', 'pic'] });
    await expect(provider.getPic!(request())).resolves.toBe('https://img.test/cover.jpg');

    const failingPic = createSandboxStub((record) =>
      record.action === 'pic' ? { ok: false, result: null, error: '炸' } : urlOutcome('u'),
    );
    expect(await createProvider(failingPic, { actions: ['musicUrl', 'pic'] }).getPic!(request())).toBe('');

    const unsupported = createSandboxStub(() => urlOutcome('u'));
    expect(await createProvider(unsupported, { actions: ['musicUrl'] }).getPic!(request())).toBe('');
  });
});
