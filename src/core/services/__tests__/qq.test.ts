import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptQrc } from 'qrc-decoder';
import { fetchQQLyrics, getQQTopListDetail, getQQTopLists, qqMusicuFetch, searchQQ } from '../qq';
import { getProxies } from '../proxy';
import { SELF_HOSTED_PROXY } from '../config';
import { parseLyrics } from '../../utils/lyrics';

vi.mock('qrc-decoder', () => ({ decryptQrc: vi.fn() }));
vi.mock('../proxy', async (original) => ({ ...await original<typeof import('../proxy')>(), getProxies: vi.fn() }));
const fetchMock = vi.fn<typeof fetch>();
const response = (data: unknown, code = 0) => new Response(JSON.stringify({ req: { code, data } }));
const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

beforeEach(() => {
  vi.clearAllMocks(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  vi.mocked(getProxies).mockReturnValue([SELF_HOSTED_PROXY, 'https://proxy.test/?url=']);
  vi.mocked(decryptQrc).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('QQ musicu 协议', () => {
  it('封装客户端参数、带本地鉴权并释放失败响应', async () => {
    const bad = new Response('busy', { status: 503 }); const cancel = vi.spyOn(bad.body!, 'cancel');
    fetchMock.mockResolvedValueOnce(bad).mockResolvedValueOnce(response({ ok: true }));
    expect(await qqMusicuFetch({ method: 'Example' })).toEqual({ ok: true });
    expect(cancel).toHaveBeenCalledOnce();
    const options = fetchMock.mock.calls[0][1]!;
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(JSON.parse(options.body as string)).toMatchObject({ comm: { ct: 11 }, req: { method: 'Example' } });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ mode: 'cors' });
  });

  it('业务拒绝或网络失败尝试完返回 null，取消立即传播', async () => {
    fetchMock.mockResolvedValueOnce(response({}, 500)).mockRejectedValueOnce(new Error('offline'));
    expect(await qqMusicuFetch({})).toBeNull();
    const controller = new AbortController(); controller.abort(new Error('cancel'));
    fetchMock.mockRejectedValue(new Error('aborted'));
    await expect(qqMusicuFetch({}, controller.signal)).rejects.toThrow('cancel');
  });

  it('搜索经经典桌面接口映射 MID、歌词 ID、多歌手与空字段', async () => {
    const searchResponse = (song: unknown) => new Response(JSON.stringify({ code: 0, data: { song } }));
    fetchMock.mockResolvedValueOnce(searchResponse({ list: [
      { songid: 12, songmid: 'mid', strMediaMid: 'file-mid', songname: '夜曲', singer: [{ name: '甲' }, { name: '乙' }], albumname: '专辑', albummid: 'album' }, { songid: 13 },
    ] }));
    const songs = await searchQQ('夜曲', 2, 20);
    expect(songs[0]).toMatchObject({ id: 'mid', lyricId: '12', strMediaMid: 'file-mid', artist: '甲, 乙', album: '专辑', source: 'qq' });
    expect(songs[1].strMediaMid).toBeUndefined();
    expect(songs[0].pic).toContain('album.jpg');
    expect(songs[1]).toMatchObject({ id: '13', name: '', artist: '', album: '', pic: '' });

    // 搜索必须走 GET 经典接口：musicu 的搜索端点已对未登录请求返回空列表
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    // 目标 URL 会被整体 encodeURIComponent 交给代理，所以这里解两层。
    const decoded = decodeURIComponent(decodeURIComponent(url));
    expect(decoded).toContain('c.y.qq.com/soso/fcgi-bin/client_search_cp');
    expect(decoded).toContain('w=夜曲');
    expect(decoded).toContain('p=2');
    expect(decoded).toContain('n=20');
    expect(options.method).toBe('GET');

    fetchMock.mockResolvedValueOnce(searchResponse({ totalnum: 0, list: [] }));
    expect(await searchQQ('空', 1, 10)).toEqual([]);
    fetchMock.mockResolvedValueOnce(searchResponse({}));
    await expect(searchQQ('错误', 1, 10)).rejects.toThrow('QQ 音乐搜索响应不可用');
  });

  it('搜索的代理链全部失败时返回不可用，业务码非 0 时保留码值', async () => {
    // 每个代理都网络失败，走完轮询后返回 null
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(searchQQ('晴天', 1, 10)).rejects.toThrow('QQ 音乐搜索响应不可用');

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 2001, data: null })));
    await expect(searchQQ('晴天', 1, 10)).rejects.toThrow('业务码 2001');
  });

  it('搜索过程中取消会立刻传播，不再尝试剩余代理', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancel'));
    fetchMock.mockRejectedValue(new Error('aborted'));
    await expect(searchQQ('晴天', 1, 10, controller.signal)).rejects.toThrow('cancel');
  });

  it('榜单兼容接口别名以及空响应', async () => {
    fetchMock.mockResolvedValueOnce(response({ group: [{ toplist: [{ topId: 1, title: '热榜', period: '每日', frontPicUrl: 'http://img.test/a' }] }, {}] }));
    expect((await getQQTopLists())[0]).toMatchObject({ id: '1', name: '热榜', picUrl: 'http://img.test/a' });
    fetchMock.mockResolvedValueOnce(response({ groupList: [{ topList: [{ topId: 2, name: '新榜', headPicUrl: 'http://img.test/b' }] }, { list: [{ topId: 3, musichallPicUrl: 'http://img.test/c' }, {}] }] }));
    expect(await getQQTopLists()).toHaveLength(3);
    fetchMock.mockResolvedValueOnce(response({})); expect(await getQQTopLists()).toEqual([]);
    fetchMock.mockImplementation(() => Promise.resolve(response({}, 1)));
    expect(await getQQTopLists()).toEqual([]);
  });

  it('榜单详情支持嵌套和扁平歌曲列表', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: { songInfoList: [{ id: 1, mid: 'mid', file: { media_mid: 'file-mid' }, title: '标题', singer: [{ name: '歌手' }], album: { title: '专辑', mid: 'album' } }] } }));
    expect((await getQQTopListDetail('1'))[0]).toMatchObject({ name: '标题', artist: '歌手', album: '专辑', strMediaMid: 'file-mid' });
    fetchMock.mockResolvedValueOnce(response({ songInfoList: [{ id: 2, name: '歌名', album: { name: '专辑名' } }, {}] }));
    expect(await getQQTopListDetail('2')).toHaveLength(2);
    fetchMock.mockResolvedValueOnce(response({})); expect(await getQQTopListDetail('3')).toEqual([]);
    fetchMock.mockImplementation(() => Promise.resolve(response({}, 1)));
    expect(await getQQTopListDetail('4')).toEqual([]);
  });
});

describe('QQ 歌词', () => {
  it('解码 UTF-8、译文与罗马音，数字 ID 同时传入 songID', async () => {
    fetchMock.mockResolvedValueOnce(response({ lyric: base64('[00:01.00]你好'), trans: base64('[00:01.00]Hello'), roma: base64('[00:01.00]ni hao') }));
    expect(parseLyrics(await fetchQQLyrics(42))[0]).toMatchObject({ text: '你好', translation: 'Hello', romanization: 'ni hao' });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).req.param).toMatchObject({ songMID: '42', songID: 42 });
  });

  it('提取加密 QRC XML 中的内容和实体', async () => {
    vi.mocked(decryptQrc).mockReturnValue('<LyricInfo LyricContent="[00:01.00]&quot;A&apos; &lt;B&gt; &amp;"/>');
    fetchMock.mockResolvedValueOnce(response({ qrc: 1, lyric: 'a'.repeat(16), trans: '%%%' }));
    expect(await fetchQQLyrics('mid')).toContain('"A\' <B> &');
    vi.mocked(decryptQrc).mockReturnValue('[1000,1000]Hello(0,1000)');
    fetchMock.mockResolvedValueOnce(response({ qrc: 1, lyric: 'b'.repeat(16) }));
    expect(await fetchQQLyrics('mid')).toContain('[tunefree:karaoke]');
  });

  it('处理无效密文、解码异常、非字符串与不可用歌词', async () => {
    fetchMock.mockResolvedValueOnce(response({ qrc: 1, lyric: 12 }));
    expect(await fetchQQLyrics('bad')).toBe('');
    fetchMock.mockResolvedValueOnce(response({ qrc: 1, lyric: base64('[00:01.00]plain') }));
    expect(await fetchQQLyrics('plain')).toBe('[00:01.00]plain');
    vi.mocked(decryptQrc).mockReturnValue('');
    fetchMock.mockResolvedValueOnce(response({ qrc: 1, lyric: 'a'.repeat(16) })); await fetchQQLyrics('empty');
    vi.mocked(decryptQrc).mockImplementation(() => { throw new Error('corrupt'); });
    fetchMock.mockResolvedValueOnce(response({ qrc: 1, lyric: 'b'.repeat(16) })); await fetchQQLyrics('corrupt');
    fetchMock.mockImplementation(() => Promise.resolve(response({}, 1)));
    expect(await fetchQQLyrics('missing')).toBe('');
    const controller = new AbortController(); controller.abort(new Error('cancel'));
    fetchMock.mockRejectedValue(new Error('aborted'));
    await expect(fetchQQLyrics('cancel', controller.signal)).rejects.toThrow('cancel');
  });
});
