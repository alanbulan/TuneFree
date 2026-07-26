import { useCallback, useEffect, useState } from 'react';
import { invokeCommand, isTauri } from '../../../../core/ipc';
import { writeCachedDownloadDir } from '../../../utils/downloadDirCache';
import { useLibrary, type LibraryImportMode, type LibraryImportPreview } from '../../../../core/contexts/LibraryContext';
import { useDesktopPreferences } from '../../../../core/contexts/DesktopPreferencesContext';
import { useTheme } from '../../../../core/contexts/ThemeContext';
import { readLyricDisplayMode, saveLyricDisplayMode, type LyricDisplayMode } from '../../../../core/utils/lyricDisplayMode';
import {
  clearRecommendationData,
  getLlmConfig,
  rebuildRecommendationIndex,
  saveLlmConfig,
  testLlmProvider,
  type LlmConfigView,
} from '../../../../core/services/recommendation';
import { useDesktopDialog } from '../../../components/DialogHost';
import { useToast } from '../../../components/ToastHost';
import { describeIpcFailure, retryWhileBusy } from '../ipcErrorFeedback';
import { useStorageOverview } from './useStorageOverview';

const defaultLlmConfig: LlmConfigView = {
  localRecommendationEnabled: true,
  enabled: false,
  baseUrl: '',
  model: '',
  timeoutMs: 8000,
  maxCandidates: 80,
  maxResults: 30,
  cacheTtlSeconds: 86400,
  uploadRecentEvents: false,
  hasApiKey: false,
  databaseSizeBytes: 0,
  llmCacheEntries: 0,
  lastError: null,
};

export function useSettingsViewModel() {
  const preferences = useDesktopPreferences();
  const theme = useTheme();
  const library = useLibrary();
  const { confirmDialog } = useDesktopDialog();
  const { showToast } = useToast();
  const [tempProxy, setTempProxy] = useState(library.corsProxy);
  const [tempShowPet, setTempShowPet] = useState(true);
  const [lyricDisplayMode, setLyricDisplayMode] = useState<LyricDisplayMode>('line');
  const [downloadPath, setDownloadPath] = useState('');
  const [pendingImport, setPendingImport] = useState<LibraryImportPreview | null>(null);
  const [localRecommendationEnabled, setLocalRecommendationEnabled] = useState(true);
  const [llmConfig, setLlmConfig] = useState<LlmConfigView>(defaultLlmConfig);
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [savingLlm, setSavingLlm] = useState(false);
  const [maintainingRecommendation, setMaintainingRecommendation] = useState(false);
  const [recommendationInitializing, setRecommendationInitializing] = useState(false);

  // 推荐服务在后台线程初始化，未就绪时命令返回 BUSY，这里统一退避重试（契约 §7.7）。
  const runRecommendationCommand = useCallback(
    <T,>(run: () => Promise<T>): Promise<T> =>
      retryWhileBusy(run, () => setRecommendationInitializing(true)).finally(() =>
        setRecommendationInitializing(false),
      ),
    [],
  );

  /** 结构化错误按 code 分流；CANCELLED 静默，其余按语气展示后端中文文案。 */
  const reportFailure = useCallback(
    (error: unknown, fallback: string) => {
      const { message, tone } = describeIpcFailure(error, fallback);
      if (message) showToast(message, tone);
    },
    [showToast],
  );

  const refreshLlmConfig = useCallback(async () => {
    try {
      const config = await runRecommendationCommand(getLlmConfig);
      setLlmConfig(config);
      setLocalRecommendationEnabled(config.localRecommendationEnabled);
      localStorage.setItem('tunefree_local_recommendation_enabled', config.localRecommendationEnabled ? 'true' : 'false');
    } catch {
      setLlmConfig(defaultLlmConfig);
    }
  }, [runRecommendationCommand]);

  useEffect(() => {
    setTempShowPet(localStorage.getItem('tunefree_desktop_show_pet') !== 'false');
    setLyricDisplayMode(readLyricDisplayMode(localStorage));
    setLocalRecommendationEnabled(localStorage.getItem('tunefree_local_recommendation_enabled') !== 'false');
    void refreshLlmConfig();
  }, [refreshLlmConfig]);

  // 下载目录以后端为唯一事实来源，渲染层不再从 localStorage 读取或回传。
  useEffect(() => {
    if (!isTauri()) return;
    invokeCommand('get_download_dir').then(setDownloadPath).catch(() => {});
  }, []);

  const selectDownloadDir = async () => {
    try {
      const path = await invokeCommand('select_download_dir');
      if (!path) return;
      setDownloadPath(path);
      writeCachedDownloadDir(path);
      showToast('下载路径已成功更改', 'success');
    } catch (error: unknown) {
      reportFailure(error, '选择目录失败');
    }
  };

  const resetDownloadDir = async () => {
    try {
      const path = await invokeCommand('reset_download_dir');
      setDownloadPath(path);
      writeCachedDownloadDir(path);
      showToast('下载路径已恢复为默认目录', 'success');
    } catch (error: unknown) {
      reportFailure(error, '恢复默认路径失败');
    }
  };

  const saveCoreSettings = () => {
    library.setCorsProxy(tempProxy);
    localStorage.setItem('tunefree_desktop_show_pet', tempShowPet ? 'true' : 'false');
    window.dispatchEvent(new Event('tunefree_pet_toggle'));
    showToast('设置已保存', 'success');
  };

  const changeLyricDisplayMode = (mode: LyricDisplayMode, label: string) => {
    setLyricDisplayMode(mode);
    saveLyricDisplayMode(mode);
    showToast(`歌词显示方式已切换为：${label}`, 'success');
  };

  const exportLibrary = () => {
    const result = library.exportData();
    showToast(result.ok ? `已导出 ${result.filename}` : result.error, result.ok ? 'success' : 'error');
  };

  const importFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result
        ? library.parseImportData(event.target.result as string)
        : { ok: false as const, error: '文件读取失败' };
      if (!result.ok) {
        setPendingImport(null);
        showToast(result.error, 'error');
        return;
      }
      setPendingImport(result.data);
      showToast('已读取导入文件，请先确认预览', 'info');
    };
    reader.onerror = () => showToast('文件读取失败', 'error');
    reader.readAsText(file);
  };

  const applyPendingImport = async (mode: LibraryImportMode) => {
    if (!pendingImport) return;
    const isReplace = mode === 'replace';
    const confirmed = await confirmDialog({
      title: isReplace ? '覆盖导入资料库' : '合并导入资料库',
      message: isReplace
        ? '覆盖导入会替换当前收藏和歌单，操作后可通过提示撤销。是否继续？'
        : '合并导入会把文件内容加入当前资料库，重复歌曲会按现有规则处理。是否继续？',
      confirmLabel: isReplace ? '覆盖导入' : '合并导入',
      tone: isReplace ? 'danger' : 'default',
    });
    if (!confirmed) return;
    const result = library.applyImportData(pendingImport, mode);
    if (!result.ok) {
      showToast(result.error, 'error');
      return;
    }
    setPendingImport(null);
    showToast(isReplace ? '数据已覆盖导入' : '数据已合并导入', 'success', {
      label: '撤销',
      onClick: () => {
        library.restoreData(result.backup);
        showToast('已撤销导入', 'success');
      },
    });
  };

  const getLlmInput = () => ({
    localRecommendationEnabled,
    enabled: llmConfig.enabled,
    baseUrl: llmConfig.baseUrl,
    model: llmConfig.model,
    timeoutMs: llmConfig.timeoutMs,
    maxCandidates: llmConfig.maxCandidates,
    maxResults: llmConfig.maxResults,
    cacheTtlSeconds: llmConfig.cacheTtlSeconds,
    uploadRecentEvents: llmConfig.uploadRecentEvents,
    apiKey: apiKey.trim() || undefined,
    clearApiKey,
  });

  const saveRecommendationSettings = async () => {
    setSavingLlm(true);
    try {
      localStorage.setItem('tunefree_local_recommendation_enabled', localRecommendationEnabled ? 'true' : 'false');
      await runRecommendationCommand(() => saveLlmConfig(getLlmInput()));
      setApiKey('');
      setClearApiKey(false);
      await refreshLlmConfig();
      showToast('推荐系统配置已保存', 'success');
    } catch (error: unknown) {
      reportFailure(error, '保存推荐配置失败');
    } finally {
      setSavingLlm(false);
    }
  };

  const testProvider = async () => {
    setTestingLlm(true);
    try {
      const result = await runRecommendationCommand(() => testLlmProvider(getLlmInput()));
      const message = result.ok
        ? `模型连接成功${result.latencyMs ? `，${result.latencyMs}ms` : ''}`
        : result.error || '模型连接失败';
      showToast(message, result.ok ? 'success' : 'error');
      await refreshLlmConfig();
    } catch (error: unknown) {
      reportFailure(error, '模型连接失败');
    } finally {
      setTestingLlm(false);
    }
  };

  const maintainRecommendation = async (action: 'rebuild' | 'clear') => {
    if (action === 'clear') {
      const confirmed = await confirmDialog({
        title: '清空推荐数据',
        message: '这会删除推荐事件、画像、缓存、历史云端结果和反馈，不会删除收藏、歌单或下载文件。是否继续？',
        confirmLabel: '清空',
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    setMaintainingRecommendation(true);
    try {
      await runRecommendationCommand<unknown>(() =>
        action === 'rebuild' ? rebuildRecommendationIndex() : clearRecommendationData(),
      );
      await refreshLlmConfig();
      showToast(action === 'rebuild' ? '推荐索引已重建' : '推荐数据已清空', 'success');
    } catch (error: unknown) {
      reportFailure(error, action === 'rebuild' ? '重建推荐索引失败' : '清空推荐数据失败');
    } finally {
      setMaintainingRecommendation(false);
    }
  };

  const storageOverview = useStorageOverview(library.favorites, library.playlists, llmConfig);

  return {
    core: { tempProxy, setTempProxy, tempShowPet, setTempShowPet, downloadPath, selectDownloadDir, resetDownloadDir, saveCoreSettings, ...preferences, showToast },
    appearance: { ...theme, lyricDisplayMode, changeLyricDisplayMode, showToast },
    recommendation: { localRecommendationEnabled, setLocalRecommendationEnabled, llmConfig, setLlmConfig, apiKey, setApiKey, clearApiKey, setClearApiKey, testingLlm, savingLlm, maintainingRecommendation, initializing: recommendationInitializing, saveRecommendationSettings, testProvider, maintainRecommendation },
    backup: { pendingImport, setPendingImport, favorites: library.favorites, playlists: library.playlists, exportLibrary, importFile, applyPendingImport, storageOverview },
  };
}

export type SettingsViewModel = ReturnType<typeof useSettingsViewModel>;
