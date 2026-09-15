import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import SourcesView from '../SourcesView';
import { useMusicSourcesViewModel } from '../sources/useMusicSourcesViewModel';
import { MusicSourceRuntime } from '../../../components/MusicSourceRuntime';
import type { MusicSourceEntry } from '../../../../core/services/sources/manager';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(async () => undefined),
  toast: vi.fn(),
  confirm: vi.fn(async () => true),
  importFiles: vi.fn(
    async (
      _inputs: Array<{ fileName: string; text: string }>,
    ): Promise<Array<{ fileName: string; ok: boolean; message: string }>> => [],
  ),
  importFromUrl: vi.fn(async () => ({ fileName: 'x.js', ok: true, message: '已导入' })),
  remove: vi.fn(),
  setEnabled: vi.fn(),
  setNameMatch: vi.fn(),
  reload: vi.fn(),
  ensureInitialized: vi.fn(async () => undefined),
}));

const state = vi.hoisted(() => ({
  entries: [] as MusicSourceEntry[],
  revision: 0,
  snapshot: null as { entries: MusicSourceEntry[]; readyCount: number } | null,
  snapshotRevision: -1,
}));

vi.mock('../../../../core/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../core/ipc')>()),
  isTauri: mocks.isTauri,
  invokeCommand: mocks.invoke,
}));

vi.mock('../../../../core/services/sources/manager', () => ({
  subscribeMusicSources: () => () => {},
  getMusicSourcesSnapshot: () => {
    if (state.snapshotRevision !== state.revision || !state.snapshot) {
      state.snapshot = {
        entries: state.entries,
        readyCount: state.entries.filter((entry) => entry.status === 'ready').length,
      };
      state.snapshotRevision = state.revision;
    }
    return state.snapshot;
  },
  importMusicSourceFiles: mocks.importFiles,
  importMusicSourceFromUrl: mocks.importFromUrl,
  removeMusicSource: mocks.remove,
  setMusicSourceEnabled: mocks.setEnabled,
  setMusicSourceNameMatchFallback: mocks.setNameMatch,
  reloadMusicSources: mocks.reload,
  ensureMusicSourcesInitialized: mocks.ensureInitialized,
}));

vi.mock('../../../components/ToastHost', () => ({
  useToast: () => ({ showToast: mocks.toast, dismissToast: vi.fn() }),
}));

vi.mock('../../../components/DialogHost', () => ({
  useDesktopDialog: () => ({ confirmDialog: mocks.confirm, promptDialog: vi.fn() }),
}));

const entry = (overrides: Partial<MusicSourceEntry> = {}): MusicSourceEntry => ({
  record: {
    id: 'source-1',
    name: '星海音乐源',
    version: 'v3.2.11',
    author: '万去了了',
    description: '聚合音源',
    homepage: 'https://example.test/',
    fileName: 'xinghai.js',
    content: 'x',
    enabled: true,
    nameMatchFallback: false,
    importedAt: 1,
    bytes: 10,
  },
  status: 'ready',
  error: '',
  platforms: [
    { appPlatform: 'netease', lxPlatform: 'wy', actions: ['musicUrl'], qualitys: ['320k', 'flac'] },
  ],
  updateAlert: null,
  hosts: ['yy.zddyr.top'],
  logs: ['[就绪] 声明平台：wy'],
  ...overrides,
});

const setEntries = (...entries: MusicSourceEntry[]) => {
  state.entries = entries;
  state.revision += 1;
};

const fileOf = (name: string, content = 'globalThis.lx;'): File =>
  new File([content], name, { type: 'text/javascript' });

describe('SourcesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauri.mockReturnValue(false);
    mocks.confirm.mockResolvedValue(true);
    mocks.remove.mockReturnValue(null);
    mocks.setEnabled.mockReturnValue(null);
    mocks.setNameMatch.mockReturnValue(null);
    mocks.importFromUrl.mockResolvedValue({ fileName: 'x.js', ok: true, message: '已导入' });
    mocks.importFiles.mockResolvedValue([{ fileName: 'a.js', ok: true, message: '已导入' }]);
    setEntries();
  });

  afterEach(() => {
    cleanup();
  });

  it('空状态给出导入说明', () => {
    render(<SourcesView />);
    expect(screen.getByText('还没有添加音源')).toBeTruthy();
    expect(screen.getByRole('button', { name: '导入文件' })).toBeTruthy();
    expect(screen.queryByText(/洛雪|LX Music/)).toBeNull();
  });

  it('多选文件导入：读取文本并汇总提示', async () => {
    render(<SourcesView />);
    const input = document.querySelector('.sources-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOf('a.js'), fileOf('b.txt')] } });

    await waitFor(() => expect(mocks.importFiles).toHaveBeenCalledTimes(1));
    const inputs = mocks.importFiles.mock.calls[0][0] as Array<{ fileName: string; text: string }>;
    expect(inputs.map((item) => item.fileName)).toEqual(['a.js', 'b.txt']);
    expect(inputs[0].text).toBe('globalThis.lx;');
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('已导入 1 个音源', 'success'));
  });

  it('非脚本文件与读取失败都有明确提示', async () => {
    render(<SourcesView />);
    const input = document.querySelector('.sources-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOf('cover.png')] } });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('请选择音源文件（.js 或 .txt）', 'warning'));
    expect(mocks.importFiles).not.toHaveBeenCalled();

    const readFailure = vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
      this.dispatchEvent(new ProgressEvent('error'));
    });
    fireEvent.change(input, { target: { files: [fileOf('broken.js')] } });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('读取 broken.js 失败', 'error'));
    readFailure.mockRestore();
  });

  it('导入结果汇总：全部失败、部分成功', async () => {
    render(<SourcesView />);
    const input = document.querySelector('.sources-file-input') as HTMLInputElement;

    mocks.importFiles.mockResolvedValue([{ fileName: 'a.js', ok: false, message: '语法错误' }]);
    fireEvent.change(input, { target: { files: [fileOf('a.js')] } });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('语法错误', 'error'));

    mocks.importFiles.mockResolvedValue([
      { fileName: 'a.js', ok: true, message: '已导入' },
      { fileName: 'b.js', ok: false, message: '内容为空' },
    ]);
    fireEvent.change(input, { target: { files: [fileOf('a.js'), fileOf('b.js')] } });
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith('1 个成功，1 个失败：内容为空', 'warning'),
    );
  });

  it('链接导入：校验链接、成功后清空输入', async () => {
    render(<SourcesView />);
    const urlInput = screen.getByLabelText('音源脚本链接');
    const linkButton = screen.getByRole('button', { name: /链接导入/ });

    fireEvent.change(urlInput, { target: { value: 'ftp://x' } });
    fireEvent.click(linkButton);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('请输入以 http(s) 开头的脚本链接', 'warning'));
    expect(mocks.importFromUrl).not.toHaveBeenCalled();

    fireEvent.change(urlInput, { target: { value: 'https://example.test/source.js' } });
    fireEvent.click(linkButton);
    await waitFor(() => expect(mocks.importFromUrl).toHaveBeenCalledWith('https://example.test/source.js'));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('已导入 x.js', 'success'));
    expect((urlInput as HTMLInputElement).value).toBe('');

    mocks.importFromUrl.mockResolvedValue({ fileName: 'x.js', ok: false, message: '源代理请求失败' });
    fireEvent.change(urlInput, { target: { value: 'https://example.test/source.js' } });
    fireEvent.keyDown(urlInput, { key: 'Enter' });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('源代理请求失败', 'error'));
  });

  it('点击导入按钮打开文件选择框', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', { name: '导入文件' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('拖拽脚本文件到页面即触发导入，拖到子元素上不会误清除状态', async () => {
    render(<SourcesView />);
    const page = document.querySelector('.sources-page') as HTMLElement;
    const toolbar = document.querySelector('.sources-toolbar') as HTMLElement;

    fireEvent.dragOver(page);
    expect(page.className).toContain('is-dropping');

    // 指针进入子元素时不应清掉拖拽态（happy-dom 的 DragEvent 不认 relatedTarget，
    // 因此用 MouseEvent 构造同语义事件）。
    fireEvent(page, new MouseEvent('dragleave', { relatedTarget: toolbar, bubbles: true }));
    expect(page.className).toContain('is-dropping');

    // 真正离开页面（relatedTarget 在容器之外）才清除。
    fireEvent(page, new MouseEvent('dragleave', { relatedTarget: document.body, bubbles: true }));
    expect(page.className).not.toContain('is-dropping');

    fireEvent.drop(page, { dataTransfer: { files: [fileOf('drag.js')] } });
    await waitFor(() => expect(mocks.importFiles).toHaveBeenCalledTimes(1));
  });

  it('渲染音源状态、平台标签与详情', async () => {
    setEntries(
      entry({
        updateAlert: { log: '发现新版本', updateUrl: 'https://example.test/update' },
        platforms: [
          { appPlatform: 'netease', lxPlatform: 'wy', actions: ['musicUrl', 'lyric'], qualitys: ['320k', 'flac'] },
          { appPlatform: 'kugou', lxPlatform: 'kg', actions: ['musicUrl'] },
        ],
      }),
    );
    render(<SourcesView />);

    expect(screen.getByText('星海音乐源')).toBeTruthy();
    expect(screen.getByText('已就绪')).toBeTruthy();
    expect(screen.getByText('v3.2.11')).toBeTruthy();
    expect(screen.getByText('网易云')).toBeTruthy();
    expect(screen.getByText('酷狗音乐')).toBeTruthy();
    expect(mocks.toast).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /展开.*的详情/ }));
    expect(screen.getByText('聚合音源')).toBeTruthy();
    expect(screen.getByText(/网易云（320k \/ flac）、酷狗音乐（由脚本决定）/)).toBeTruthy();
    expect(screen.getByText(/yy.zddyr.top/)).toBeTruthy();
    expect(screen.getByText(/发现新版本/)).toBeTruthy();
    expect(screen.getByText(/声明平台：wy/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /收起.*的详情/ }));
    expect(screen.queryByText('聚合音源')).toBeNull();

    // 升级提示里的链接按钮同样走主页打开逻辑。
    const openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    fireEvent.click(screen.getByRole('button', { name: /展开.*的详情/ }));
    fireEvent.click(screen.getByRole('button', { name: '查看更新' }));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith('https://example.test/update', '_blank', 'noopener,noreferrer'),
    );
    vi.unstubAllGlobals();
  });

  it('启停、按歌名匹配开关与删除都调用管理器', async () => {
    setEntries(entry());
    render(<SourcesView />);

    fireEvent.click(screen.getByLabelText('启用 星海音乐源'));
    expect(mocks.setEnabled).toHaveBeenCalledWith('source-1', false);

    fireEvent.click(screen.getByRole('button', { name: /展开.*的详情/ }));
    fireEvent.click(screen.getByLabelText(/允许按歌名匹配/));
    expect(mocks.setNameMatch).toHaveBeenCalledWith('source-1', true);

    fireEvent.click(screen.getByRole('button', { name: /删除/ }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('source-1'));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('已删除「星海音乐源」', 'success'));

    mocks.confirm.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: /删除/ }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it('主页按钮在浏览器与桌面环境分别走 window.open 与 IPC', async () => {
    setEntries(entry());
    const openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', { name: /展开.*的详情/ }));

    fireEvent.click(screen.getByRole('button', { name: /主页/ }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://example.test/', '_blank', 'noopener,noreferrer'));
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.isTauri.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /主页/ }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('open_external_url', { url: 'https://example.test/' }),
    );

    mocks.invoke.mockRejectedValueOnce(new Error('IPC 失败'));
    fireEvent.click(screen.getByRole('button', { name: /主页/ }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('打开链接失败，请稍后重试', 'error'));
    expect(openSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('保存失败时显示错误，删除不再误报成功', async () => {
    const item = entry();
    mocks.remove.mockReturnValue('存储空间不足');
    mocks.setEnabled.mockReturnValue('存储空间不足');
    mocks.setNameMatch.mockReturnValue('存储空间不足');
    const { result } = renderHook(() => useMusicSourcesViewModel());
    await act(async () => {
      result.current.toggleEnabled(item, false);
      result.current.toggleNameMatch(item.record.id, true);
      await result.current.remove(item);
    });
    expect(mocks.toast.mock.calls).toEqual([
      ['存储空间不足', 'error'], ['存储空间不足', 'error'], ['存储空间不足', 'error'],
    ]);
  });

  it('捕获导入异常，恢复忙碌状态并保留链接', async () => {
    const { result } = renderHook(() => useMusicSourcesViewModel());
    mocks.importFiles.mockRejectedValueOnce(new Error('脚本读取失败'));
    await act(async () => { await result.current.importFiles([fileOf('a.js')]); });
    expect(mocks.toast).toHaveBeenCalledWith('脚本读取失败', 'error');
    expect(result.current.importing).toBe(false);

    act(() => result.current.setUrlInput('https://example.test/source.js'));
    mocks.importFromUrl.mockRejectedValueOnce(new Error('下载失败'));
    await act(async () => { await result.current.importFromUrl(); });
    expect(mocks.toast).toHaveBeenCalledWith('下载失败', 'error');
    expect(result.current.importing).toBe(false);
    expect(result.current.urlInput).toBe('https://example.test/source.js');
  });

  it('导入尚未结束时不会因重复点击或拖放启动另一批导入', async () => {
    let finish!: (value: { fileName: string; ok: boolean; message: string }) => void;
    mocks.importFromUrl.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useMusicSourcesViewModel());
    act(() => result.current.setUrlInput('https://example.test/source.js'));
    let pending!: Promise<void>;
    act(() => { pending = result.current.importFromUrl(); });
    await act(async () => {
      await result.current.importFromUrl();
      await result.current.importFiles([fileOf('a.js')]);
    });
    expect(mocks.importFromUrl).toHaveBeenCalledTimes(1);
    expect(mocks.importFiles).not.toHaveBeenCalled();
    expect(result.current.importing).toBe(true);
    await act(async () => {
      finish({ fileName: 'x.js', ok: true, message: '已导入' });
      await pending;
    });
    expect(result.current.importing).toBe(false);
  });

  // eslint-disable-next-line no-script-url -- 验证来自脚本的危险 URL 会被拒绝。
  it.each(['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'http://example.test/', 'invalid'])(
    '拒绝打开脚本提供的非 HTTPS 链接：%s', async (url) => {
      const openSpy = vi.spyOn(window, 'open');
      const { result } = renderHook(() => useMusicSourcesViewModel());
      await act(async () => { await result.current.openHomepage(url); });
      expect(mocks.toast).toHaveBeenCalledWith('仅支持打开有效的 HTTPS 链接', 'warning');
      expect(openSpy).not.toHaveBeenCalled();
      expect(mocks.invoke).not.toHaveBeenCalled();
      openSpy.mockRestore();
    },
  );

  it('重新加载与失败状态展示', async () => {
    setEntries(entry({ status: 'failed', error: '脚本加载失败：语法错误', platforms: [] }));
    render(<SourcesView />);

    expect(screen.getByText('加载失败')).toBeTruthy();
    expect(screen.getByText('脚本加载失败：语法错误')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }));
    expect(mocks.reload).toHaveBeenCalled();

    setEntries(entry({ status: 'ready', platforms: [] }));
    cleanup();
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', { name: /展开.*的详情/ }));
    expect(screen.getByText('未声明可用平台')).toBeTruthy();
  });

  it('内置脚本条目只读：显示内置标记，没有启停、删除与按歌名匹配开关', () => {
    const builtin = entry({
      record: { ...entry().record, id: 'builtin:gd', name: 'GD音乐台', author: 'GD Studio',
        version: '1.0.0', fileName: '内置脚本', builtin: true },
    });
    setEntries(builtin);
    render(<SourcesView />);

    expect(screen.getByText('内置')).toBeTruthy();
    expect(screen.getByText('GD音乐台')).toBeTruthy();
    expect(screen.getByText('适配 v1.0.0')).toBeTruthy();
    expect(screen.queryByLabelText('启用 GD音乐台')).toBeNull();
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /展开.*的详情/ }));
    expect(screen.queryByLabelText(/允许按歌名匹配/)).toBeNull();
    // 内置脚本的来源信息仍然可见
    expect(screen.getByText('内置脚本')).toBeTruthy();
    expect(screen.getByText('接口作者')).toBeTruthy();
    expect(screen.getByText('GD Studio')).toBeTruthy();
    expect(screen.getByText('平台与请求音质')).toBeTruthy();
    expect(screen.getByTitle('实际音质以接口返回为准')).toBeTruthy();
  });

  it('内置条目的启停与删除在视图模型层被忽略', async () => {
    const builtin = entry({ record: { ...entry().record, id: 'builtin:gd', builtin: true } });
    setEntries(builtin);
    const { result } = renderHook(() => useMusicSourcesViewModel());

    await act(async () => {
      await result.current.remove(builtin);
      result.current.toggleEnabled(builtin, false);
    });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.setEnabled).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('桌面环境启动时初始化音源，浏览器环境不启动', async () => {
    render(<MusicSourceRuntime />);
    expect(mocks.ensureInitialized).not.toHaveBeenCalled();

    mocks.isTauri.mockReturnValue(true);
    render(<MusicSourceRuntime />);
    await waitFor(() => expect(mocks.ensureInitialized).toHaveBeenCalledTimes(1));

    mocks.ensureInitialized.mockRejectedValueOnce(new Error('初始化失败'));
    cleanup();
    render(<MusicSourceRuntime />);
    await act(async () => {
      await Promise.resolve();
    });
  });
});
