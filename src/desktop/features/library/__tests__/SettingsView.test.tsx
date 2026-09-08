import { type PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryProvider } from '../../../../core/contexts/LibraryContext';
import { DesktopPreferencesProvider } from '../../../../core/contexts/DesktopPreferencesContext';
import { ThemeProvider } from '../../../../core/contexts/ThemeContext';
import { IpcError } from '../../../../core/ipc';
import { getLlmConfig, saveLlmConfig, testLlmProvider, clearRecommendationData, rebuildRecommendationIndex, type LlmConfigView } from '../../../../core/services/recommendation';
import { useSettingsViewModel } from '../settings/useSettingsViewModel';
import { formatBytes } from '../settings/useStorageOverview';
import SettingsView from '../SettingsView';
import StorageOverviewCard from '../components/StorageOverviewCard';
import { updateRecommendationTaskProgress } from '../../../../core/services/recommendationTaskProgress';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn(), confirm: vi.fn(), list: vi.fn(),
  tauri: true, offlineChanged: null as null | (() => void), unsubscribe: vi.fn() }));
vi.mock('../../../../core/ipc', async (original) => ({ ...await original<typeof import('../../../../core/ipc')>(),
  isTauri: () => mocks.tauri, invokeCommand: mocks.invoke, emitEventTo: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../../core/services/recommendation', async (original) => ({ ...await original<typeof import('../../../../core/services/recommendation')>(),
  getLlmConfig: vi.fn(), saveLlmConfig: vi.fn(), testLlmProvider: vi.fn(), rebuildRecommendationIndex: vi.fn(), clearRecommendationData: vi.fn() }));
vi.mock('../../../../core/services/offlineDownloads', () => ({ listOfflineDownloads: mocks.list,
  subscribeOfflineDownloads: (callback: () => void) => { mocks.offlineChanged = callback; return mocks.unsubscribe; } }));
vi.mock('../../../components/ToastHost', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('../../../components/DialogHost', () => ({ useDesktopDialog: () => ({ confirmDialog: mocks.confirm }) }));

const config: LlmConfigView = { localRecommendationEnabled: true, enabled: false, baseUrl: '', model: '',
  timeoutMs: 8000, maxCandidates: 80, maxResults: 30, cacheTtlSeconds: 86400, uploadRecentEvents: false,
  hasApiKey: false, databaseSizeBytes: 2048, llmCacheEntries: 2, lastError: null };
const song = { id: '1', name: '夜曲', artist: '歌手', album: '', source: 'qq' };
const importJson = JSON.stringify({ version: 4, favorites: [song], playlists: [{ id: 'p1', name: '歌单', createTime: 1, songs: [song] }] });
function Wrapper({ children }: PropsWithChildren) {
  return <ThemeProvider><DesktopPreferencesProvider><LibraryProvider>{children}</LibraryProvider></DesktopPreferencesProvider></ThemeProvider>;
}
const mountModel = () => renderHook(useSettingsViewModel, { wrapper: Wrapper });
const ready = async () => { await act(async () => {}); };
const failStorageWrites = () => {
  const original = localStorage;
  vi.stubGlobal('localStorage', { getItem: original.getItem.bind(original), removeItem: original.removeItem.bind(original),
    setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); } });
  return () => vi.stubGlobal('localStorage', original);
};
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.tauri = true; mocks.offlineChanged = null;
  mocks.invoke.mockReset().mockImplementation((command: string) => Promise.resolve(command.endsWith('download_dir') ? 'C:/Music' : undefined));
  mocks.list.mockReset().mockResolvedValue([]); mocks.confirm.mockReset().mockResolvedValue(true);
  vi.mocked(getLlmConfig).mockReset().mockResolvedValue({ ...config });
  vi.mocked(saveLlmConfig).mockReset().mockResolvedValue(undefined);
  vi.mocked(testLlmProvider).mockReset().mockResolvedValue({ ok: true, latencyMs: 35, status: 'ok', supportsJsonObject: true });
  vi.mocked(clearRecommendationData).mockReset().mockResolvedValue({ databaseSizeBytes: 0, llmCacheEntries: 0 });
  vi.mocked(rebuildRecommendationIndex).mockReset().mockResolvedValue(undefined);
  updateRecommendationTaskProgress({ local: { status: 'idle', detail: '等待推荐任务', updatedAt: 0 }, cloud: { status: 'idle', detail: '等待推荐任务', updatedAt: 0 } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('设置持久化与备份', () => {
  it('读取后端配置并保存代理、伙伴和歌词偏好，目录选择取消不改变路径', async () => {
    const { result } = mountModel(); await ready();
    expect(result.current.core.downloadPath).toBe('C:/Music');
    expect(result.current.recommendation.llmConfig.databaseSizeBytes).toBe(2048);
    act(() => { result.current.core.setTempProxy('https://proxy.test/?url='); result.current.core.setTempShowPet(false); });
    const toggle = vi.fn(); window.addEventListener('tunefree_pet_toggle', toggle);
    act(() => result.current.core.saveCoreSettings());
    expect(localStorage.getItem('tunefree_desktop_show_pet')).toBe('false'); expect(toggle).toHaveBeenCalledOnce();
    window.removeEventListener('tunefree_pet_toggle', toggle);
    act(() => result.current.appearance.changeLyricDisplayMode('karaoke', '逐字动态'));
    expect(result.current.appearance.lyricDisplayMode).toBe('karaoke');
    mocks.invoke.mockResolvedValueOnce(null);
    await act(() => result.current.core.selectDownloadDir());
    expect(result.current.core.downloadPath).toBe('C:/Music');
    mocks.invoke.mockResolvedValueOnce('D:/Music'); await act(() => result.current.core.selectDownloadDir());
    expect(result.current.core.downloadPath).toBe('D:/Music');
    mocks.invoke.mockResolvedValueOnce('C:/Default'); await act(() => result.current.core.resetDownloadDir());
    expect(result.current.core.downloadPath).toBe('C:/Default');
  });

  it('目录错误按 IPC 类型反馈，取消静默，存储不足时不报告配置保存成功', async () => {
    const { result } = mountModel(); await ready(); mocks.toast.mockClear();
    mocks.invoke.mockRejectedValueOnce(new IpcError('CANCELLED', '取消'));
    await act(() => result.current.core.selectDownloadDir()); expect(mocks.toast).not.toHaveBeenCalled();
    mocks.invoke.mockRejectedValueOnce(new IpcError('IO', '目录不可写'));
    await act(() => result.current.core.resetDownloadDir()); expect(mocks.toast).toHaveBeenLastCalledWith('目录不可写', 'error');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failStorageWrites();
    mocks.toast.mockClear(); act(() => result.current.core.saveCoreSettings());
    expect(mocks.toast).not.toHaveBeenCalled(); expect(warning).toHaveBeenCalled();
  });

  it('真实 JSON 文件先预览，再确认合并/覆盖，撤销恢复原曲库', async () => {
    const { result } = mountModel(); await ready();
    await act(() => result.current.backup.applyPendingImport('replace'));
    expect(mocks.confirm).not.toHaveBeenCalled();
    act(() => result.current.backup.importFile(new File([importJson], 'backup.json')));
    await waitFor(() => expect(result.current.backup.pendingImport?.favoriteCount).toBe(1));
    expect(result.current.backup.favorites).toEqual([]);
    mocks.confirm.mockResolvedValueOnce(false);
    await act(() => result.current.backup.applyPendingImport('replace'));
    expect(result.current.backup.pendingImport).not.toBeNull();
    await act(() => result.current.backup.applyPendingImport('merge'));
    expect(result.current.backup.favorites).toEqual([song]);
    expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: '合并导入资料库' }));
    const undo = mocks.toast.mock.lastCall![2].onClick;
    act(undo); expect(result.current.backup.favorites).toEqual([]);
    act(() => result.current.backup.importFile(new File([importJson], 'backup.json')));
    await waitFor(() => expect(result.current.backup.pendingImport).not.toBeNull());
    await act(() => result.current.backup.applyPendingImport('replace'));
    expect(result.current.backup.favorites).toHaveLength(1);
    expect(mocks.toast).toHaveBeenLastCalledWith('数据已覆盖导入', 'success', expect.anything());
  });

  it('导入写入失败保留预览和原数据，撤销写入失败不误报成功', async () => {
    const { result } = mountModel(); await ready();
    act(() => result.current.backup.importFile(new File([importJson], 'backup.json')));
    await waitFor(() => expect(result.current.backup.pendingImport).not.toBeNull());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restoreStorage = failStorageWrites();
    await act(() => result.current.backup.applyPendingImport('replace'));
    expect(result.current.backup.favorites).toEqual([]); expect(result.current.backup.pendingImport).not.toBeNull();
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.stringContaining('曲库保存失败'), 'error');
    restoreStorage(); await act(() => result.current.backup.applyPendingImport('replace'));
    const undo = mocks.toast.mock.lastCall![2].onClick;
    failStorageWrites();
    mocks.toast.mockClear(); act(undo); expect(mocks.toast).not.toHaveBeenCalled();
    expect(result.current.backup.favorites).toHaveLength(1);
  });

  it('损坏、空文件和读取失败不会应用数据，导出释放临时 URL', async () => {
    const { result } = mountModel(); await ready();
    act(() => result.current.backup.importFile());
    act(() => result.current.backup.importFile(new File(['{broken'], 'bad.json')));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('JSON 解析失败'), 'error'));
    act(() => result.current.backup.importFile(new File([''], 'empty.json')));
    await waitFor(() => expect(mocks.toast).toHaveBeenLastCalledWith('文件读取失败', 'error'));
    vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) { this.dispatchEvent(new ProgressEvent('error')); });
    mocks.toast.mockClear(); act(() => result.current.backup.importFile(new File(['{}'], 'io.json')));
    expect(mocks.toast).toHaveBeenCalledWith('文件读取失败', 'error');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    act(() => result.current.backup.exportLibrary());
    expect(revoke).toHaveBeenCalledWith('blob:backup');
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.stringContaining('已导出'), 'success');
    create.mockImplementation(() => { throw new Error('no blob'); });
    act(() => result.current.backup.exportLibrary());
    expect(mocks.toast).toHaveBeenLastCalledWith('导出失败，请稍后再试', 'error');
  });
});

describe('推荐配置与统计', () => {
  it('初始化 BUSY 期间显示状态，500ms 后读取成功，非 BUSY 错误使用初始配置', async () => {
    vi.useFakeTimers();
    vi.mocked(getLlmConfig).mockRejectedValueOnce(new IpcError('BUSY', '初始化'));
    const { result, unmount } = mountModel(); await ready();
    expect(result.current.recommendation.initializing).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(result.current.recommendation.initializing).toBe(false);
    expect(result.current.recommendation.llmConfig.llmCacheEntries).toBe(2); unmount();
    mocks.tauri = false; vi.mocked(getLlmConfig).mockRejectedValueOnce(new Error('offline'));
    const failed = mountModel(); await ready();
    expect(failed.result.current.recommendation.llmConfig.databaseSizeBytes).toBe(0);
  });

  it('保存配置去除密钥空白并刷新状态，模型连接和维护均正确报告成功/失败', async () => {
    const { result } = mountModel(); await ready();
    act(() => { result.current.recommendation.setApiKey(' test-only '); result.current.recommendation.setClearApiKey(true);
      result.current.recommendation.setLocalRecommendationEnabled(false); });
    await act(() => result.current.recommendation.saveRecommendationSettings());
    expect(saveLlmConfig).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'test-only', clearApiKey: true, localRecommendationEnabled: false }));
    expect(result.current.recommendation.apiKey).toBe(''); expect(result.current.recommendation.clearApiKey).toBe(false);
    vi.mocked(saveLlmConfig).mockRejectedValueOnce(new IpcError('IO', '配置未保存'));
    await act(() => result.current.recommendation.saveRecommendationSettings());
    expect(mocks.toast).toHaveBeenLastCalledWith('配置未保存', 'error'); expect(result.current.recommendation.savingLlm).toBe(false);
    await act(() => result.current.recommendation.testProvider());
    expect(mocks.toast).toHaveBeenLastCalledWith('模型连接成功，35ms', 'success');
    vi.mocked(testLlmProvider).mockResolvedValueOnce({ ok: true, latencyMs: 0, status: 'ok', supportsJsonObject: true });
    await act(() => result.current.recommendation.testProvider()); expect(mocks.toast).toHaveBeenLastCalledWith('模型连接成功', 'success');
    vi.mocked(testLlmProvider).mockResolvedValueOnce({ ok: false, error: '模型不存在', status: 'error', supportsJsonObject: false });
    await act(() => result.current.recommendation.testProvider()); expect(mocks.toast).toHaveBeenLastCalledWith('模型不存在', 'error');
    vi.mocked(testLlmProvider).mockResolvedValueOnce({ ok: false, status: 'error', supportsJsonObject: false }); await act(() => result.current.recommendation.testProvider());
    expect(mocks.toast).toHaveBeenLastCalledWith('模型连接失败', 'error');
    vi.mocked(testLlmProvider).mockRejectedValueOnce(new IpcError('NETWORK', '离线'));
    await act(() => result.current.recommendation.testProvider());
    expect(mocks.toast).toHaveBeenLastCalledWith('离线，请检查网络后重试', 'warning');
    expect(result.current.recommendation.testingLlm).toBe(false);
    await act(() => result.current.recommendation.maintainRecommendation('rebuild'));
    expect(rebuildRecommendationIndex).toHaveBeenCalledOnce();
    mocks.confirm.mockResolvedValueOnce(false); await act(() => result.current.recommendation.maintainRecommendation('clear'));
    expect(clearRecommendationData).not.toHaveBeenCalled();
    await act(() => result.current.recommendation.maintainRecommendation('clear'));
    expect(mocks.toast).toHaveBeenLastCalledWith('推荐数据已清空', 'success');
    vi.mocked(rebuildRecommendationIndex).mockRejectedValueOnce(new Error('rebuild failed'));
    await act(() => result.current.recommendation.maintainRecommendation('rebuild'));
    vi.mocked(clearRecommendationData).mockRejectedValueOnce(new Error('clear failed'));
    await act(() => result.current.recommendation.maintainRecommendation('clear'));
    expect(result.current.recommendation.maintainingRecommendation).toBe(false);
    expect(mocks.toast).toHaveBeenLastCalledWith('clear failed', 'error');
  });

  it('统计真实下载大小、排除虚拟收藏歌单，失败提示并在通知后恢复', async () => {
    mocks.list.mockResolvedValue([{ size: 1048576 }, { size: -2 }, {}]);
    const { result, unmount } = mountModel(); await ready();
    expect(result.current.backup.storageOverview.segments[0].formattedValue).toBe('1.0 MB');
    expect(result.current.backup.storageOverview.stats[2].value).toBe('0 个');
    mocks.list.mockRejectedValueOnce(new Error('disk'));
    await act(async () => mocks.offlineChanged?.());
    expect(result.current.backup.storageOverview.error).toContain('暂时无法读取');
    expect(result.current.backup.storageOverview.totalLabel).toBe('已统计占用');
    mocks.list.mockResolvedValueOnce([]); await act(async () => mocks.offlineChanged?.());
    expect(result.current.backup.storageOverview.error).toBe('');
    expect(formatBytes(1)).toBe('1 B'); expect(formatBytes(1024)).toBe('1 KB'); unmount();
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });
});

describe('设置页面真实控件', () => {
  it('主题、歌词、行为、推荐输入和备份操作均与视图模型连接', async () => {
    render(<SettingsView />, { wrapper: Wrapper }); await ready();
    for (const name of ['深色模式', '浅色模式', '跟随系统', '逐字动态', '逐行显示', '最小化到托盘', '退出应用', '每次询问']) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    fireEvent.change(screen.getByRole('slider'), { target: { value: '30' } });
    expect(localStorage.getItem('tunefree_lyric_size')).toBe('30');
    const swatches = document.querySelectorAll('.color-swatch'); fireEvent.click(swatches[2]);
    fireEvent.change(document.querySelector('input[type=color]')!, { target: { value: '#123456' } });
    fireEvent.click(screen.getByRole('button', { name: '系统默认' })); fireEvent.click(screen.getByRole('option', { name: '宋体' }));
    for (const name of ['启用桌面歌词', '锁定桌面歌词', '锁定桌面歌词', '显示音乐伙伴', '根据播放与收藏发现好音乐', '使用已配置的模型发现和精选音乐', '清除已保存密钥', '允许上传最近少量事件摘要']) {
      fireEvent.click(screen.getByRole('checkbox', { name }));
    }
    fireEvent.change(screen.getByPlaceholderText('留空使用内置代理（推荐）'), { target: { value: 'https://proxy.test/' } });
    fireEvent.change(screen.getByPlaceholderText('https://api.openai.com/v1'), { target: { value: 'https://model.test/v1' } });
    fireEvent.change(screen.getByPlaceholderText('例如 gpt-4.1-mini'), { target: { value: 'test-model' } });
    fireEvent.change(screen.getByPlaceholderText('输入服务商提供的 API Key'), { target: { value: 'test-key' } });
    fireEvent.click(screen.getByRole('button', { name: '高级参数' }));
    for (const input of screen.getAllByRole('spinbutton')) fireEvent.change(input, { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: '更改目录' })); fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    for (const button of screen.getAllByRole('button', { name: '保存配置' })) fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: '测试连接' })); await ready();
    expect(testLlmProvider).toHaveBeenCalledWith(expect.objectContaining({ model: 'test-model', baseUrl: 'https://model.test/v1', timeoutMs: 1000 }));
    fireEvent.click(screen.getByRole('button', { name: '推荐数据管理' }));
    fireEvent.click(screen.getByRole('button', { name: '重建索引' })); await ready();
    fireEvent.click(screen.getByRole('button', { name: '清空推荐数据' })); await ready();
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File([importJson], 'backup.json')] } });
    await screen.findByText('导入预览');
    fireEvent.click(screen.getByRole('button', { name: '合并导入' })); await ready();
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File([importJson], 'backup.json')] } });
    await screen.findByText('导入预览'); fireEvent.click(screen.getByRole('button', { name: '覆盖导入' })); await ready();
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File([importJson], 'backup.json')] } });
    await screen.findByText('导入预览'); fireEvent.click(screen.getByRole('button', { name: '取消' }));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }));
    act(() => updateRecommendationTaskProgress({ cloud: { status: 'done', detail: '精选完成', updatedAt: 1000 } }));
    expect(screen.getByText('精选完成')).toBeTruthy();
  });

  it('空存储图没有无效比例，统计失败提示可读', () => {
    const view = render(<StorageOverviewCard totalLabel="已统计占用" totalValue="0 B" error="统计失败"
      segments={[{ id: 'empty', label: '空', value: 0, formattedValue: '0 B', color: '#000000' }]} stats={[]} />);
    expect(within(view.container).getByRole('status').textContent).toBe('统计失败');
    expect(view.container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});
