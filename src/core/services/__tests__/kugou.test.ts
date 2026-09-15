import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { buildKugouSignature, buildKugouQualityHashes, searchKugou } from '../kugou';

const mocks = vi.hoisted(() => ({ proxyFetchJson: vi.fn() }));

vi.mock('../proxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../proxy')>()),
  proxyFetchJson: mocks.proxyFetchJson,
}));

const kugouItem = {
  FileHash: 'FILE_HASH',
  HQFileHash: 'HQ_HASH',
  SQFileHash: 'SQ_HASH',
  ResFileHash: 'RES_HASH',
  SuperFileHash: '',
  SongName: '晴天&nbsp;',
  SingerName: '周杰伦',
  Singers: [{ name: '周杰伦' }, { name: '温岚' }],
  AlbumName: '叶惠美',
  AlbumID: '966846',
  Image: 'http://imge.kugou.com/stdmusic/{size}/cover.jpg',
};

describe('kugou', () => {
  beforeEach(() => {
    mocks.proxyFetchJson.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('签名：参数按名排序后与密钥拼接再取 md5', async () => {
    const signature = await buildKugouSignature({ b: '2', a: '1' });
    // 与 node:crypto 的独立实现比对，锁定算法（密钥与排序规则都不能悄悄变）
    const { createHash } = await import('node:crypto');
    const expected = createHash('md5')
      .update(
        `NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt${'a=1b=2'}NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt`,
        'utf8',
      )
      .digest('hex');
    expect(signature).toBe(expected);
    // 参数顺序不影响签名
    expect(await buildKugouSignature({ a: '1', b: '2' })).toBe(signature);
  });

  it('音质 hash 映射只保留非空项', () => {
    expect(buildKugouQualityHashes(kugouItem)).toEqual({
      '128k': { hash: 'FILE_HASH' },
      '320k': { hash: 'HQ_HASH' },
      flac: { hash: 'SQ_HASH' },
      flac24bit: { hash: 'RES_HASH' },
    });
    expect(buildKugouQualityHashes({})).toEqual({});
  });

  it('搜索：请求带上签名参数，结果归一化为 Song', async () => {
    mocks.proxyFetchJson.mockResolvedValue({ data: { lists: [kugouItem, { SongName: '缺 hash' }, null] } });

    const songs = await searchKugou('晴天', 2, 5);
    expect(songs).toEqual([
      {
        id: 'FILE_HASH',
        name: '晴天',
        artist: '周杰伦 / 温岚',
        album: '叶惠美',
        pic: 'https://imge.kugou.com/stdmusic/480/cover.jpg',
        source: 'kugou',
        hash: 'FILE_HASH',
        albumId: '966846',
        qualityHashes: {
          '128k': { hash: 'FILE_HASH' },
          '320k': { hash: 'HQ_HASH' },
          flac: { hash: 'SQ_HASH' },
          flac24bit: { hash: 'RES_HASH' },
        },
      },
    ]);

    const [url, timeout] = mocks.proxyFetchJson.mock.calls[0] as [string, number];
    expect(url.startsWith('https://complexsearch.kugou.com/v2/search/song?')).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('keyword')).toBe('晴天');
    expect(params.get('page')).toBe('2');
    expect(params.get('pagesize')).toBe('5');
    expect(params.get('appid')).toBe('1014');
    expect(params.get('signature')).toMatch(/^[0-9a-f]{32}$/);
    expect(timeout).toBeGreaterThan(0);
  });

  it('SingerName 兜底与 http 封面被丢弃', async () => {
    mocks.proxyFetchJson.mockResolvedValue({
      data: { lists: [{ FileHash: 'H', SongName: 'x', SingerName: '独唱', Image: 'http://bad.example/x.jpg' }] },
    });
    const [song] = await searchKugou('x');
    expect(song.artist).toBe('独唱');
    // http 封面会被升级为 https，非 http 的异常地址直接丢弃
    expect(song.pic).toBe('https://bad.example/x.jpg');
  });

  it('响应结构异常时抛出可读错误', async () => {
    mocks.proxyFetchJson.mockResolvedValue(null);
    await expect(searchKugou('x')).rejects.toThrow('酷狗搜索响应不可用');
    mocks.proxyFetchJson.mockResolvedValue({ data: { lists: 'nope' } });
    await expect(searchKugou('x')).rejects.toThrow('酷狗搜索响应不可用');
  });

  it('空结果返回空数组', async () => {
    mocks.proxyFetchJson.mockResolvedValue({ data: { lists: [] } });
    await expect(searchKugou('x')).resolves.toEqual([]);
  });
});
