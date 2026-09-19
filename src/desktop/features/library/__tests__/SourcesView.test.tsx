import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import SourcesView from '../SourcesView';
import { useMusicSourcesViewModel } from '../sources/useMusicSourcesViewModel';
import { MusicSourceRuntime } from '../../../components/MusicSourceRuntime';
import type { MusicSourceEntry } from '../../../../core/services/sources/manager';
import type { SourceUpdateState } from '../../../../core/services/sources/sourceUpdates';
import { recordFailure, resetCircuits } from '../../../../core/services/sources/circuitBreaker';

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
  move: vi.fn(),
  setEnabled: vi.fn(),
  setNameMatch: vi.fn(),
  reload: vi.fn(),
  checkUpdates: vi.fn(async (): Promise<SourceUpdateState[]> => []),
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
  moveMusicSource: mocks.move,
  setMusicSourceEnabled: mocks.setEnabled,
  setMusicSourceNameMatchFallback: mocks.setNameMatch,
  reloadMusicSources: mocks.reload,
  checkMusicSourceUpdates: mocks.checkUpdates,
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
  calls: [],
  update: null,
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

  it('支持拖拽和键盘排序，内部拖拽不触发导入，也不显示 emoji', () => {
    setEntries(entry(), entry({ record: { ...entry().record, id: 'second', name: '第二音源🐱' } }));
    render(<SourcesView />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[1].textContent).toBe('第二音源');
    fireEvent.dragStart(tabs[0], { dataTransfer: { setData: vi.fn() } });
    fireEvent.dragOver(tabs[1], { dataTransfer: {} });
    fireEvent.drop(tabs[1], { dataTransfer: {} });
    expect(mocks.move).toHaveBeenCalledWith('source-1', 'second');
    expect(mocks.importFiles).not.toHaveBeenCalled();
    expect(screen.queryByText('松开以导入音源')).toBeNull();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight', altKey: true });
    expect(mocks.move).toHaveBeenCalledTimes(2);
    fireEvent.dragStart(tabs[0], { dataTransfer: { setData: vi.fn() } });
    fireEvent.dragEnd(tabs[0]);
    fireEvent.drop(tabs[1], { dataTransfer: { files: [] } });
    expect(mocks.move).toHaveBeenCalledTimes(2);
    expect(mocks.importFiles).not.toHaveBeenCalled();
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

    fireEvent.dragOver(page, { dataTransfer: { types: ['Files'] } });
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

    expect(screen.getByRole('tab', { name: /星海音乐源/ })).toBeTruthy();
    expect(screen.getAllByText('已加载 · 待验证').length).toBeGreaterThan(0);
    expect(screen.queryByText('已就绪')).toBeNull();
    expect(screen.getByRole('region', { name: '星海音乐源 诊断信息' })).toBeTruthy();
    expect(screen.getByText(/声明平台：wy/)).toBeTruthy();
    // 诊断卡片里只有「运行日志」这个折叠块；补充资料的详情此时还没展开。
    expect(document.querySelector('.source-detail')).toBeNull();
    expect(screen.getByText('v3.2.11')).toBeTruthy();
    expect(screen.getByText('网易云')).toBeTruthy();
    expect(screen.getByText('酷狗音乐')).toBeTruthy();
    expect(mocks.toast).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /展开.*的详情/ }));
    expect(screen.getByText('聚合音源')).toBeTruthy();
    expect(screen.getByText('320k / flac')).toBeTruthy();
    expect(screen.getByText('由脚本决定')).toBeTruthy();
    expect(screen.getByText(/yy.zddyr.top/)).toBeTruthy();
    expect(screen.getByText(/发现新版本/)).toBeTruthy();
    expect(screen.getByText(/声明平台：wy/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /收起.*的详情/ }));
    expect(screen.queryByText('聚合音源')).toBeNull();
    expect(screen.getByText(/声明平台：wy/)).toBeTruthy();

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

  it('解析失败在主卡片直接展示，并且不会宣称音源已就绪', () => {
    setEntries(entry({ calls: [{ source: 'wy', action: 'musicUrl', quality: '320k', ok: false,
      message: '解析结果格式错误', durationMs: 500, checkedAt: 1 }] }));
    render(<SourcesView />);
    expect(screen.getByText('最近解析失败')).toBeTruthy();
    expect(screen.getByText('解析结果格式错误')).toBeTruthy();
    expect(screen.queryByText('已就绪')).toBeNull();
    expect(screen.getByRole('button', { name: /展开.*的详情/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('已初始化的脚本崩溃时展示运行异常，区分初始化失败', () => {
    setEntries(entry({ status: 'failed', error: 'Cannot read properties of null' }));
    render(<SourcesView />);
    expect(screen.getByText('运行异常')).toBeTruthy();
    expect(screen.getByText('运行已中止')).toBeTruthy();
    expect(screen.queryByText('初始化失败')).toBeNull();
  });

  it('运行日志默认收起，展开后按级别着色、归并重复项并分页', () => {
    setEntries(entry({ logs: [
      '[09:12:01] [已加载] 声明平台：wy / kw',
      '[09:12:05] [请求失败] api.test：上游 500',
      '[09:12:05] [log] 上游 500',
      '[09:12:05] [调用失败] kw · musicUrl：上游 500',
      '[09:12:07] [请求失败] api.test：上游 500',
      '[09:12:07] [log] 上游 500',
    ] }));
    render(<SourcesView />);

    const toggle = screen.getByText('运行日志').closest('summary')!;
    // 默认收起：日志内容不该被当作常驻信息展示
    expect(document.querySelector('.source-log')!.hasAttribute('open')).toBe(false);

    fireEvent.click(toggle);
    const rows = document.querySelectorAll('.source-log-rows li');
    // 6 行原始日志归并成 4 类：重复的「请求失败 / log」合并并计数
    expect(rows).toHaveLength(4);
    // 失败与调用失败算异常；[log] 是脚本自己的 console 输出，保持中性不误报
    expect(document.querySelectorAll('.source-log-rows .is-danger')).toHaveLength(2);
    expect(screen.getAllByText('×2')).toHaveLength(2);
    // 时间列来自日志行首的时间戳
    expect(screen.getByText('09:12:01')).toBeTruthy();
    // 每类都在一页内时不出翻页控件
    expect(document.querySelector('.source-log-pager')).toBeNull();
  });

  it('日志超过一页时出现翻页，且不再渲染滚动条容器', () => {
    setEntries(entry({ logs: Array.from({ length: 9 }, (_, index) =>
      `[09:2${index}:00] [事件] 第 ${index} 条`) }));
    render(<SourcesView />);
    fireEvent.click(screen.getByText('运行日志').closest('summary')!);

    expect(document.querySelectorAll('.source-log-rows li')).toHaveLength(4);
    expect(screen.getByText('第 1 / 3 页')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '下一页日志' }));
    expect(screen.getByText('第 2 / 3 页')).toBeTruthy();
    expect(screen.getByText('第 4 条')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '下一页日志' }));
    expect(screen.getByText('第 8 条')).toBeTruthy();
    expect(screen.getByRole('button', { name: '下一页日志' })).toHaveProperty('disabled', true);

    // 退回上一页后「上一页」仍可用，回到首页才禁用
    fireEvent.click(screen.getByRole('button', { name: '上一页日志' }));
    expect(screen.getByText('第 2 / 3 页')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '上一页日志' }));
    expect(screen.getByText('第 1 / 3 页')).toBeTruthy();
    expect(screen.getByRole('button', { name: '上一页日志' })).toHaveProperty('disabled', true);
  });

  it('解析记录只展示最近几条，更早的合并成计数', () => {
    const call = (index: number, ok: boolean) => ({
      source: 'wy', action: 'musicUrl', quality: '320k', ok,
      message: ok ? '' : `第 ${index} 次失败`, durationMs: 100 * index, checkedAt: 1_700_000_000_000 + index,
    });
    setEntries(entry({ calls: [call(1, false), call(2, false), call(3, true), call(4, true), call(5, true)] }));
    render(<SourcesView />);

    const rows = document.querySelectorAll('.source-call-list li');
    // 最近 3 条 + 1 行「另有 N 条」汇总
    expect(rows).toHaveLength(4);
    expect(document.querySelector('.source-call-more')?.textContent).toBe('另有 2 条更早的解析记录');
  });

  it('标签方向键循环切换，Home / End 跳到首尾', () => {
    setEntries(
      entry(),
      entry({ record: { ...entry().record, id: 'source-2', name: '第二音源' } }),
      entry({ record: { ...entry().record, id: 'source-3', name: '第三音源' } }),
    );
    render(<SourcesView />);
    const tablist = screen.getByRole('tablist');
    const selected = () => document.querySelector('[role=tab][aria-selected=true]')?.textContent;

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(selected()).toContain('第二音源');
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(selected()).toContain('星海音乐源');
    // 向左越界时回卷到最后一项
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(selected()).toContain('第三音源');
    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(selected()).toContain('星海音乐源');
    fireEvent.keyDown(tablist, { key: 'End' });
    expect(selected()).toContain('第三音源');
  });

  it('熔断的通道单独列出，说明跳过原因与冷却时间', () => {
    for (let index = 0; index < 3; index += 1) {
      recordFailure('gdstudio', 'joox', 'search', new Error('GD 接口 HTTP 503'));
    }
    setEntries(entry());
    render(<SourcesView />);

    const panel = screen.getByLabelText('已熔断的通道');
    expect(panel.textContent).toContain('JOOX');
    expect(panel.textContent).toContain('搜索');
    expect(panel.textContent).toContain('GD 接口 HTTP 503');
    expect(panel.hasAttribute('open')).toBe(false);
    expect(panel.textContent).toContain('连续失败 3 次');
    expect(panel.textContent).toContain('下次请求会尝试恢复');
    resetCircuits();
  });

  it('标签溢出时给出左右滚动按钮', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollBy').mockImplementation(() => {});
    // happy-dom 没有真实布局，直接给滚动容器伪造溢出尺寸
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 900 });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 });
    setEntries(entry(), entry({ record: { ...entry().record, id: 'source-2', name: '第二音源' } }));
    render(<SourcesView />);

    const right = screen.getByRole('button', { name: '向右滚动音源标签' });
    expect(screen.queryByRole('button', { name: '向左滚动音源标签' })).toBeNull();
    fireEvent.click(right);
    expect(HTMLElement.prototype.scrollBy).toHaveBeenCalled();

    // 已经滚到中间时两个方向都应出现
    const scroller = document.querySelector('.source-tabs') as HTMLElement;
    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, value: 120 });
    fireEvent.scroll(scroller);
    const left = screen.getByRole('button', { name: '向左滚动音源标签' });
    fireEvent.click(left);
    expect(HTMLElement.prototype.scrollBy).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: -220 }),
    );
  });

  it('音源以标签栏呈现，点击标签切换详情面板', () => {
    setEntries(
      entry(),
      entry({ record: { ...entry().record, id: 'source-2', name: '第二音源' } }),
    );
    render(<SourcesView />);

    // 默认展开第一个；第二个的详情不渲染，页面高度与音源数量无关
    expect(screen.getByRole('tab', { name: /星海音乐源/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /第二音源/ }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('region', { name: '星海音乐源 诊断信息' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '第二音源 诊断信息' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /第二音源/ }));
    expect(screen.getByRole('tab', { name: /第二音源/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('region', { name: '第二音源 诊断信息' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '星海音乐源 诊断信息' })).toBeNull();
    // tabpanel 通过 aria-labelledby 指回对应的 tab
    const panel = screen.getByRole('tabpanel');
    expect(panel.id).toBe('source-panel-source-2');
    expect(panel.getAttribute('aria-labelledby')).toBe('source-tab-source-2');
  });

  it('方向键在标签之间切换，选中项被删除后回落到第一项', () => {
    setEntries(
      entry(),
      entry({ record: { ...entry().record, id: 'source-2', name: '第二音源' } }),
    );
    const view = render(<SourcesView />);

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /第二音源/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    // 循环回到第一个
    expect(screen.getByRole('tab', { name: /星海音乐源/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(screen.getByRole('tab', { name: /第二音源/ }).getAttribute('aria-selected')).toBe('true');

    // 选中的音源被移除后不能停在空白面板上
    setEntries(entry());
    view.rerender(<SourcesView />);
    expect(screen.getByRole('tab', { name: /星海音乐源/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('region', { name: '星海音乐源 诊断信息' })).toBeTruthy();
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

    expect(screen.getByText('初始化失败')).toBeTruthy();
    expect(screen.getByText('脚本加载失败：语法错误')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }));
    expect(mocks.reload).toHaveBeenCalled();

    setEntries(entry({ status: 'ready', platforms: [] }));
    cleanup();
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', { name: /展开.*的详情/ }));
    expect(screen.getByText('尚无可用平台声明')).toBeTruthy();
  });

  it('检查更新展示汇总，只有真实解析成功才显示成功状态', async () => {
    mocks.checkUpdates.mockResolvedValueOnce([
      { status: 'updated', message: '已更新至 2.0.0' },
      { status: 'failed', message: '上游不可达' },
      { status: 'unsupported', message: '作者未提供更新链接' },
    ]);
    setEntries(entry({ calls: [{ source: 'wy', action: 'musicUrl', quality: '128k', ok: true,
      message: '返回合法播放地址', durationMs: 100, checkedAt: 1 }] }));
    render(<SourcesView />);
    expect(screen.getAllByText('最近解析成功').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '检查并更新' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('更新检查完成：1 个已更新，1 个失败，1 个未提供更新链接', 'warning'));
  });

  it('更新和重载失败释放忙碌状态，更新期间重复操作只执行一次', async () => {
    let finish!: (value: SourceUpdateState[]) => void;
    mocks.checkUpdates.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useMusicSourcesViewModel());
    let pending!: Promise<void>;
    act(() => { pending = result.current.checkUpdates(); });
    expect(result.current.checkingUpdates).toBe(true);
    await act(() => result.current.checkUpdates());
    expect(mocks.checkUpdates).toHaveBeenCalledTimes(1);
    await act(async () => { finish([]); await pending; });
    expect(result.current.checkingUpdates).toBe(false);
    expect(mocks.toast).toHaveBeenLastCalledWith('更新检查完成：0 个已更新', 'success');
    mocks.checkUpdates.mockRejectedValueOnce(new Error('检查服务失败'));
    await act(() => result.current.checkUpdates());
    expect(result.current.checkingUpdates).toBe(false);
    expect(mocks.toast).toHaveBeenLastCalledWith('检查服务失败', 'error');
    mocks.reload.mockRejectedValueOnce(new Error('重载失败'));
    await act(() => result.current.reload());
    expect(result.current.reloading).toBe(false);
    expect(mocks.toast).toHaveBeenLastCalledWith('重载失败', 'error');
  });

  it('内置脚本条目只读：显示内置标记，没有启停、删除与按歌名匹配开关', () => {
    const builtin = entry({
      record: { ...entry().record, id: 'builtin:gd', name: 'GD音乐台', author: 'GD Studio',
        version: '1.0.0', fileName: '内置脚本', builtin: true },
    });
    setEntries(builtin);
    render(<SourcesView />);

    expect(screen.getByText('内置')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /GD音乐台/ })).toBeTruthy();
    expect(screen.getByText('适配 v1.0.0')).toBeTruthy();
    expect(screen.queryByLabelText('启用 GD音乐台')).toBeNull();
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /展开.*的详情/ }));
    expect(screen.queryByLabelText(/允许按歌名匹配/)).toBeNull();
    // 内置脚本的来源信息仍然可见
    expect(screen.getByText('内置脚本')).toBeTruthy();
    expect(screen.getByText('接口作者')).toBeTruthy();
    expect(screen.getByText('GD Studio')).toBeTruthy();
    expect(screen.getByText('平台与声明音质')).toBeTruthy();
    // 音质说明改由 Tooltip 承载；提示气泡的行为在 Tooltip.test.tsx 里单独覆盖，
    // 这里只确认带说明的锚点已经渲染出来（测试环境没有真实布局，气泡不会展开）。
    expect(document.querySelector('.source-quality-list')?.closest('.tooltip-anchor')).toBeTruthy();
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
