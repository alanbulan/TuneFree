import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { searchMigu } from '../migu';

const mocks = vi.hoisted(() => ({ proxyFetchJson: vi.fn() }));

vi.mock('../proxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../proxy')>()),
  proxyFetchJson: mocks.proxyFetchJson,
}));

const miguItem = {
  id: '3790007',
  contentId: '600902000006889366',
  copyrightId: '60054701923',
  name: '晴天',
  singers: [{ id: '112', name: '周杰伦' }],
  imgItems: [
    { imgSizeType: '01', img: 'https://d.musicapp.migu.cn/small.webp' },
    { imgSizeType: '03', img: 'https://d.musicapp.migu.cn/large.webp' },
  ],
};

describe('migu', () => {
  beforeEach(() => {
    mocks.proxyFetchJson.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('搜索：结果以 copyrightId 为主键，封面取最大尺寸', async () => {
    mocks.proxyFetchJson.mockResolvedValue({ songResultData: { result: [miguItem] } });

    const songs = await searchMigu('晴天', 3, 10);
    expect(songs).toEqual([
      {
        id: '60054701923',
        name: '晴天',
        artist: '周杰伦',
        album: '',
        pic: 'https://d.musicapp.migu.cn/large.webp',
        source: 'migu',
      },
    ]);

    const [url, timeout] = mocks.proxyFetchJson.mock.calls[0] as [string, number];
    expect(url.startsWith('https://c.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do?')).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('text')).toBe('晴天');
    expect(params.get('pageNo')).toBe('3');
    expect(params.get('pageSize')).toBe('10');
    expect(params.get('ua')).toBe('Android_migu');
    expect(JSON.parse(params.get('searchSwitch')!)).toEqual({ song: 1 });
    expect(timeout).toBeGreaterThan(0);
  });

  it('缺 copyrightId 时退回资源 id，缺封面与歌手字段时留空', async () => {
    mocks.proxyFetchJson.mockResolvedValue({
      songResultData: {
        result: [
          { id: 'onlyId', name: '无版权 id' },
          { copyrightId: 'c1', name: '无封面', singers: [], imgItems: [{ img: 'http://insecure/x.jpg' }] },
        ],
      },
    });
    const songs = await searchMigu('x');
    expect(songs[0]).toMatchObject({ id: 'onlyId', artist: '', pic: '' });
    // 非 https 封面会被丢弃（页面是安全上下文，混内容图会被拦）
    expect(songs[1]).toMatchObject({ id: 'c1', pic: '' });
  });

  it('响应结构异常与空结果', async () => {
    mocks.proxyFetchJson.mockResolvedValue(null);
    await expect(searchMigu('x')).rejects.toThrow('咪咕搜索响应不可用');
    mocks.proxyFetchJson.mockResolvedValue({ songResultData: {} });
    await expect(searchMigu('x')).rejects.toThrow('咪咕搜索响应不可用');
    mocks.proxyFetchJson.mockResolvedValue({ songResultData: { result: [] } });
    await expect(searchMigu('x')).resolves.toEqual([]);
  });
});
