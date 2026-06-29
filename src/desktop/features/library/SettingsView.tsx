import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BoxesIcon, SettingsIcon, UploadIcon } from '../../../core/components/Icons';
import { useLibrary, type LibraryImportMode, type LibraryImportPreview } from '../../../core/contexts/LibraryContext';
import { useDesktopPreferences, type CloseBehavior } from '../../../core/contexts/DesktopPreferencesContext';
import { useTheme } from '../../../core/contexts/ThemeContext';
import {
  listOfflineDownloads,
  subscribeOfflineDownloads,
  type OfflineDownloadMeta,
} from '../../../core/services/offlineDownloads';
import {
  clearRecommendationData,
  getLlmConfig,
  rebuildRecommendationIndex,
  saveLlmConfig,
  testLlmProvider,
  type LlmConfigView,
} from '../../../core/services/recommendation';
import { useToast } from '../../components/ToastHost';
import CustomSelect from './components/CustomSelect';
import ColorPalette from './components/ColorPalette';
import RecommendationTaskProgressCard from './components/RecommendationTaskProgressCard';
import StorageOverviewCard, {
  type StorageOverviewSegment,
  type StorageOverviewStat,
} from './components/StorageOverviewCard';

const closeBehaviorOptions: Array<{ label: string; value: CloseBehavior; hint: string }> = [
  { label: '每次询问', value: 'ask', hint: '关闭时弹出选择，可临时决定后台运行或退出。' },
  { label: '最小化到托盘', value: 'tray', hint: '关闭主窗口后继续后台播放，可从托盘恢复。' },
  { label: '退出应用', value: 'exit', hint: '关闭主窗口时彻底退出，桌面歌词也会关闭。' },
];

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

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

const getJsonByteLength = (value: unknown): number => {
  const content = JSON.stringify(value, null, 2);
  return new TextEncoder().encode(content).length;
};

export default function SettingsView() {
  const { closeBehavior, setCloseBehavior } = useDesktopPreferences();
  const {
    themeMode,
    setThemeMode,
    themeColor,
    setThemeColor,
    lyricSize,
    setLyricSize,
    lyricFont,
    setLyricFont,
    showDesktopLyric,
    setShowDesktopLyric,
    lockDesktopLyric,
    setLockDesktopLyric,
  } = useTheme();
  const { corsProxy, setCorsProxy, favorites, playlists, exportData, parseImportData, applyImportData, restoreData } = useLibrary();
  const { showToast } = useToast();

  const [tempProxy, setTempProxy] = useState(corsProxy);
  const [tempShowPet, setTempShowPet] = useState(true);
  const [downloadPath, setDownloadPath] = useState('');
  const [pendingImport, setPendingImport] = useState<LibraryImportPreview | null>(null);
  const [localRecommendationEnabled, setLocalRecommendationEnabled] = useState(true);
  const [llmConfig, setLlmConfig] = useState<LlmConfigView>(defaultLlmConfig);
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [savingLlm, setSavingLlm] = useState(false);
  const [maintainingRecommendation, setMaintainingRecommendation] = useState(false);
  const [offlineDownloads, setOfflineDownloads] = useState<OfflineDownloadMeta[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setTempShowPet(localStorage.getItem('tunefree_desktop_show_pet') !== 'false');
      setLocalRecommendationEnabled(localStorage.getItem('tunefree_local_recommendation_enabled') !== 'false');
    }
  }, []);

  const refreshLlmConfig = async () => {
    try {
      const config = await getLlmConfig();
      setLlmConfig(config);
      setLocalRecommendationEnabled(config.localRecommendationEnabled);
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          'tunefree_local_recommendation_enabled',
          config.localRecommendationEnabled ? 'true' : 'false',
        );
      }
    } catch {
      setLlmConfig(defaultLlmConfig);
    }
  };

  useEffect(() => {
    void refreshLlmConfig();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshOfflineDownloads = async () => {
      const items = await listOfflineDownloads();
      if (!cancelled) setOfflineDownloads(items);
    };
    void refreshOfflineDownloads();
    const unsubscribe = subscribeOfflineDownloads(() => {
      void refreshOfflineDownloads();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const isTauri =
      typeof window !== 'undefined' &&
      '__TAURI_INTERNALS__' in window;
    if (!isTauri) return;
    const savedDir = localStorage.getItem('tunefree_download_dir');
    if (savedDir) {
      setDownloadPath(savedDir);
    } else {
      invoke<string>('get_default_download_dir')
        .then((path) => setDownloadPath(path))
        .catch(() => {});
    }
  }, []);

  const showMessage = (text: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    showToast(text, tone);
  };

  const handleSelectDownloadDir = async () => {
    try {
      const path = await invoke<string | null>('select_download_dir');
      if (path) {
        localStorage.setItem('tunefree_download_dir', path);
        setDownloadPath(path);
        showToast('下载路径已成功更改', 'success');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '选择目录失败';
      showToast(message, 'error');
    }
  };

  const handleResetDownloadDir = async () => {
    try {
      localStorage.removeItem('tunefree_download_dir');
      const path = await invoke<string>('get_default_download_dir');
      setDownloadPath(path);
      showToast('下载路径已恢复为默认安装目录', 'success');
    } catch {
      showToast('恢复默认路径失败', 'error');
    }
  };

  const handleExport = () => {
    const result = exportData();
    showMessage(result.ok ? `已导出 ${result.filename}` : result.error, result.ok ? 'success' : 'error');
  };

  const handleFileImport = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result
        ? parseImportData(event.target.result as string)
        : { ok: false as const, error: '文件读取失败' };
      if (!result.ok) {
        setPendingImport(null);
        showMessage(result.error, 'error');
        return;
      }
      setPendingImport(result.data);
      showMessage('已读取导入文件，请先确认预览', 'info');
    };
    reader.onerror = () => showMessage('文件读取失败', 'error');
    reader.readAsText(file);
  };

  const applyPendingImport = (mode: LibraryImportMode) => {
    if (!pendingImport) return;
    const confirmed = window.confirm(
      mode === 'replace'
        ? '覆盖导入会替换当前收藏和歌单，是否继续？'
        : '合并导入会把文件内容加入当前资料库，是否继续？',
    );
    if (!confirmed) return;

    const result = applyImportData(pendingImport, mode);
    if (!result.ok) {
      showMessage(result.error, 'error');
      return;
    }

    setPendingImport(null);
    showToast(mode === 'replace' ? '数据已覆盖导入' : '数据已合并导入', 'success', {
      label: '撤销',
      onClick: () => {
        restoreData(result.backup);
        showToast('已撤销导入', 'success');
      },
    });
  };

  const handleSaveRecommendationSettings = async () => {
    setSavingLlm(true);
    try {
      localStorage.setItem('tunefree_local_recommendation_enabled', localRecommendationEnabled ? 'true' : 'false');
      await saveLlmConfig({
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
      setApiKey('');
      setClearApiKey(false);
      await refreshLlmConfig();
      showToast('推荐系统配置已保存', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '保存推荐配置失败';
      showToast(message, 'error');
    } finally {
      setSavingLlm(false);
    }
  };

  const handleTestLlmProvider = async () => {
    setTestingLlm(true);
    try {
      const result = await testLlmProvider({
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
      showToast(
        result.ok
          ? `模型连接成功${result.latencyMs ? `，${result.latencyMs}ms` : ''}`
          : result.error || '模型连接失败',
        result.ok ? 'success' : 'error',
      );
      await refreshLlmConfig();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '模型连接失败';
      showToast(message, 'error');
    } finally {
      setTestingLlm(false);
    }
  };

  const handleRebuildRecommendationIndex = async () => {
    setMaintainingRecommendation(true);
    try {
      await rebuildRecommendationIndex();
      await refreshLlmConfig();
      showToast('推荐索引已重建', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '重建推荐索引失败';
      showToast(message, 'error');
    } finally {
      setMaintainingRecommendation(false);
    }
  };

  const handleClearRecommendationData = async () => {
    if (!window.confirm('清空推荐数据会删除推荐事件、画像、缓存和反馈，不会删除收藏、歌单或下载文件。是否继续？')) return;
    setMaintainingRecommendation(true);
    try {
      await clearRecommendationData();
      await refreshLlmConfig();
      showToast('推荐数据已清空', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '清空推荐数据失败';
      showToast(message, 'error');
    } finally {
      setMaintainingRecommendation(false);
    }
  };

  const storageOverview = useMemo(() => {
    const userPlaylists = playlists.filter((playlist) => playlist.id !== 'favorites');
    const playlistSongCount = userPlaylists.reduce((total, playlist) => total + playlist.songs.length, 0);
    const offlineAudioBytes = offlineDownloads.reduce((total, item) => total + Math.max(0, item.size || 0), 0);
    const downloadsJsonBytes = getJsonByteLength(offlineDownloads);
    const jsonBackupBytes = getJsonByteLength({
      version: 4,
      favorites,
      playlists: userPlaylists,
      exportDate: new Date().toISOString(),
    });
    const recommendationDbBytes = Math.max(0, llmConfig.databaseSizeBytes || 0);
    const totalBytes = offlineAudioBytes + recommendationDbBytes + jsonBackupBytes + downloadsJsonBytes;
    const segments: StorageOverviewSegment[] = [
      {
        id: 'offline-audio',
        label: '离线歌曲',
        value: offlineAudioBytes,
        formattedValue: formatBytes(offlineAudioBytes),
        color: '#2563eb',
      },
      {
        id: 'recommendation-db',
        label: '推荐数据库',
        value: recommendationDbBytes,
        formattedValue: formatBytes(recommendationDbBytes),
        color: '#10b981',
      },
      {
        id: 'library-backup',
        label: '收藏歌单备份',
        value: jsonBackupBytes,
        formattedValue: formatBytes(jsonBackupBytes),
        color: '#f59e0b',
      },
      {
        id: 'downloads-json',
        label: '下载索引 JSON',
        value: downloadsJsonBytes,
        formattedValue: formatBytes(downloadsJsonBytes),
        color: '#8b5cf6',
      },
    ];
    const stats: StorageOverviewStat[] = [
      {
        label: '离线歌曲',
        value: `${offlineDownloads.length} 首`,
        detail: formatBytes(offlineAudioBytes),
      },
      {
        label: '收藏',
        value: `${favorites.length} 首`,
        detail: `备份 ${formatBytes(jsonBackupBytes)}`,
      },
      {
        label: '歌单',
        value: `${userPlaylists.length} 个`,
        detail: `${playlistSongCount} 首歌`,
      },
      {
        label: '模型缓存',
        value: `${llmConfig.llmCacheEntries} 条`,
        detail: `推荐库 ${formatBytes(recommendationDbBytes)}`,
      },
    ];
    return {
      totalLabel: '总占用',
      totalValue: formatBytes(totalBytes),
      segments,
      stats,
    };
  }, [favorites, llmConfig.databaseSizeBytes, llmConfig.llmCacheEntries, offlineDownloads, playlists]);

  return (
    <section className="settings-grid">
      <div className="settings-card settings-core-card glass-panel">
        <h3><SettingsIcon size={18} /> 核心设置</h3>
        <div className="panel-field">
          <label>CORS 代理</label>
          <input className="panel-input" placeholder="留空使用内置代理（推荐）" value={tempProxy} onChange={(event) => setTempProxy(event.target.value)} />
        </div>
        <div className="panel-field" style={{ marginTop: '14px' }}>
          <label>本地下载目录</label>
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <input
              className="panel-input"
              style={{ flex: 1 }}
              readOnly
              value={downloadPath}
              placeholder="获取下载路径中..."
            />
            <button
              type="button"
              className="soft-button"
              style={{ whiteSpace: 'nowrap' }}
              onClick={handleSelectDownloadDir}
            >
              更改目录
            </button>
            <button
              type="button"
              className="soft-button"
              style={{ whiteSpace: 'nowrap' }}
              onClick={handleResetDownloadDir}
            >
              恢复默认
            </button>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '6px', lineHeight: 1.4 }}>
            默认下载到当前应用的安装目录。
          </p>
        </div>
        <div className="panel-field" style={{ marginTop: '14px' }}>
          <label>关闭主窗口时</label>
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
            {closeBehaviorOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`soft-button ${closeBehavior === option.value ? 'active' : ''}`}
                style={{
                  flex: '1 1 120px',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  backgroundColor: closeBehavior === option.value ? 'var(--accent)' : 'transparent',
                  color: closeBehavior === option.value ? 'var(--ios-card)' : 'var(--text)',
                  border: closeBehavior === option.value ? '1px solid var(--accent)' : '1px solid var(--line)',
                  fontWeight: closeBehavior === option.value ? 700 : 500,
                }}
                onClick={() => {
                  setCloseBehavior(option.value);
                  showMessage(`关闭行为已设置为：${option.label}`, 'success');
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '6px', lineHeight: 1.4 }}>
            {closeBehaviorOptions.find((option) => option.value === closeBehavior)?.hint}
          </p>
        </div>

        <div className="panel-field" style={{ marginTop: '14px' }}>
          <label>安和昴 (486) 桌宠</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
            <input
              type="checkbox"
              id="pet-toggle"
              style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent)' }}
              checked={tempShowPet}
              onChange={(event) => setTempShowPet(event.target.checked)}
            />
            <label htmlFor="pet-toggle" style={{ fontSize: '14px', cursor: 'pointer', userSelect: 'none', color: 'var(--text)' }}>启用桌面宠物</label>
          </div>
        </div>
        <div className="settings-save-row">
          <button type="button" className="primary-button" onClick={() => {
            setCorsProxy(tempProxy);
            localStorage.setItem('tunefree_desktop_show_pet', tempShowPet ? 'true' : 'false');
            window.dispatchEvent(new Event('tunefree_pet_toggle'));
            showMessage('设置已保存', 'success');
          }}>
            保存配置
          </button>
        </div>
      </div>

      <div className="settings-card settings-theme-card glass-panel">
        <h3><BoxesIcon size={18} /> 个性化与歌词</h3>

        <div className="panel-field" style={{ marginTop: '14px' }}>
          <label>主题模式</label>
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            {[
              { label: '浅色模式', value: 'light' },
              { label: '深色模式', value: 'dark' },
              { label: '跟随系统', value: 'system' },
            ].map((mode) => (
              <button
                key={mode.value}
                type="button"
                className={`soft-button ${themeMode === mode.value ? 'active' : ''}`}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  borderRadius: '8px',
                  backgroundColor: themeMode === mode.value ? 'var(--accent)' : 'transparent',
                  color: themeMode === mode.value ? 'var(--ios-card)' : 'var(--text)',
                  border: themeMode === mode.value ? '1px solid var(--accent)' : '1px solid var(--line)',
                  fontWeight: themeMode === mode.value ? 700 : 500,
                }}
                onClick={() => setThemeMode(mode.value as 'light' | 'dark' | 'system')}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        <div className="panel-field" style={{ marginTop: '14px' }}>
          <label>强调主题色</label>
          <div style={{ marginTop: '8px' }}>
            <ColorPalette value={themeColor} onChange={(color) => setThemeColor(color)} />
          </div>
        </div>

        <div className="panel-field" style={{ marginTop: '14px' }}>
          <label>歌词字号大小 ({lyricSize}px)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
            <span style={{ fontSize: '11px', opacity: 0.6 }}>小</span>
            <input
              type="range"
              min="14"
              max="36"
              value={lyricSize}
              onChange={(e) => setLyricSize(parseInt(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: '15px', fontWeight: 600 }}>大</span>
          </div>
        </div>

        <div className="panel-field" style={{ marginTop: '14px' }}>
          <label>歌词字体</label>
          <div style={{ marginTop: '6px' }}>
            <CustomSelect
              value={lyricFont}
              options={[
                { label: '系统默认', value: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif' },
                { label: '优雅苹方', value: '"PingFang SC", "Helvetica Neue", sans-serif' },
                { label: '微软雅黑', value: '"Microsoft YaHei", sans-serif' },
                { label: '宋体', value: '"SimSun", serif' },
                { label: '华文细黑', value: '"STXihei", "STHeiti", sans-serif' },
              ]}
              onChange={(val) => setLyricFont(val)}
            />
          </div>
        </div>

        <div className="panel-field" style={{ marginTop: '16px', borderTop: '1px solid var(--line)', paddingTop: '14px' }}>
          <label>桌面悬浮歌词</label>
          <div style={{ display: 'flex', gap: '20px', marginTop: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="show-lyric-toggle"
                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent)' }}
                checked={showDesktopLyric}
                onChange={(event) => setShowDesktopLyric(event.target.checked)}
              />
              <label htmlFor="show-lyric-toggle" style={{ fontSize: '14px', cursor: 'pointer', userSelect: 'none', color: 'var(--text)' }}>启用桌面歌词</label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="lock-lyric-toggle"
                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent)' }}
                checked={lockDesktopLyric}
                onChange={(event) => {
                  const nextLock = event.target.checked;
                  setLockDesktopLyric(nextLock);
                  showMessage(nextLock ? '桌面歌词已锁定（鼠标穿透）' : '桌面歌词已解锁', 'success');
                }}
              />
              <label htmlFor="lock-lyric-toggle" style={{ fontSize: '14px', cursor: 'pointer', userSelect: 'none', color: 'var(--text)' }}>锁定桌面歌词</label>
            </div>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '8px', lineHeight: 1.4 }}>
            锁定状态下鼠标将 100% 穿透歌词悬浮窗。若要解锁，请右击底部播放栏的「LRC」按钮。
          </p>
        </div>
      </div>

      <div className="settings-card settings-core-card glass-panel">
        <h3><SettingsIcon size={18} /> 推荐系统</h3>
        <div className="panel-field">
          <label>本地推荐</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="local-recommendation-toggle"
              style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent)' }}
              checked={localRecommendationEnabled}
              onChange={(event) => setLocalRecommendationEnabled(event.target.checked)}
            />
            <label htmlFor="local-recommendation-toggle" style={{ fontSize: '14px', cursor: 'pointer', userSelect: 'none', color: 'var(--text)', textTransform: 'none', letterSpacing: 0 }}>
              启用本地推荐
            </label>
          </div>
        </div>

        <div className="panel-field">
          <label>云端发现与重排</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="llm-recommendation-toggle"
              style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent)' }}
              checked={llmConfig.enabled}
              onChange={(event) => setLlmConfig((prev) => ({ ...prev, enabled: event.target.checked }))}
            />
            <label htmlFor="llm-recommendation-toggle" style={{ fontSize: '14px', cursor: 'pointer', userSelect: 'none', color: 'var(--text)', textTransform: 'none', letterSpacing: 0 }}>
              启用 OpenAI 兼容模型发现与重排
            </label>
          </div>
        </div>

        <div className="panel-field">
          <label>API 根地址</label>
          <input
            className="panel-input"
            placeholder="https://api.openai.com/v1"
            value={llmConfig.baseUrl}
            onChange={(event) => setLlmConfig((prev) => ({ ...prev, baseUrl: event.target.value }))}
          />
        </div>

        <div className="panel-field">
          <label>模型名</label>
          <input
            className="panel-input"
            placeholder="例如 gpt-4.1-mini"
            value={llmConfig.model}
            onChange={(event) => setLlmConfig((prev) => ({ ...prev, model: event.target.value }))}
          />
        </div>

        <div className="panel-field">
          <label>API Key</label>
          <input
            className="panel-input"
            type="password"
            placeholder={llmConfig.hasApiKey ? '已保存，留空保持不变' : '保存到本地配置'}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="clear-llm-key"
              style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--accent)' }}
              checked={clearApiKey}
              onChange={(event) => setClearApiKey(event.target.checked)}
            />
            <label htmlFor="clear-llm-key" style={{ fontSize: '12px', cursor: 'pointer', userSelect: 'none', color: 'var(--text-soft)', textTransform: 'none', letterSpacing: 0 }}>
              清除已保存密钥
            </label>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
          <div className="panel-field">
            <label>超时 ms</label>
            <input className="panel-input" type="number" min={1000} max={60000} value={llmConfig.timeoutMs} onChange={(event) => setLlmConfig((prev) => ({ ...prev, timeoutMs: Number(event.target.value) }))} />
          </div>
          <div className="panel-field">
            <label>候选上限</label>
            <input className="panel-input" type="number" min={1} max={120} value={llmConfig.maxCandidates} onChange={(event) => setLlmConfig((prev) => ({ ...prev, maxCandidates: Number(event.target.value) }))} />
          </div>
          <div className="panel-field">
            <label>缓存秒数</label>
            <input className="panel-input" type="number" min={60} value={llmConfig.cacheTtlSeconds} onChange={(event) => setLlmConfig((prev) => ({ ...prev, cacheTtlSeconds: Number(event.target.value) }))} />
          </div>
        </div>

        <div className="panel-field">
          <label>隐私</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="upload-recent-events"
              style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--accent)' }}
              checked={llmConfig.uploadRecentEvents}
              onChange={(event) => setLlmConfig((prev) => ({ ...prev, uploadRecentEvents: event.target.checked }))}
            />
            <label htmlFor="upload-recent-events" style={{ fontSize: '12px', cursor: 'pointer', userSelect: 'none', color: 'var(--text-soft)', textTransform: 'none', letterSpacing: 0 }}>
              允许上传最近少量事件摘要
            </label>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '6px', lineHeight: 1.4 }}>
            云端发现与重排会发送候选歌曲元数据和画像摘要；关闭后只使用本地推荐。
          </p>
        </div>

        <div className="backup-detail-list" style={{ margin: '10px 0 14px' }}>
          <span>推荐数据库：{formatBytes(llmConfig.databaseSizeBytes)}</span>
          <span>模型缓存：{llmConfig.llmCacheEntries} 条</span>
          <span>密钥状态：{llmConfig.hasApiKey ? '已保存到本地配置' : '未保存'}</span>
        </div>

        {llmConfig.lastError && (
          <p style={{ color: 'var(--danger)', fontSize: '12px', margin: '0 0 12px' }}>{llmConfig.lastError}</p>
        )}

        <div className="panel-actions backup-actions" style={{ marginTop: 'auto' }}>
          <button type="button" className="primary-button" onClick={handleSaveRecommendationSettings} disabled={savingLlm}>
            {savingLlm ? '保存中' : '保存推荐配置'}
          </button>
          <button type="button" className="soft-button" onClick={handleTestLlmProvider} disabled={testingLlm}>
            {testingLlm ? '测试中' : '测试连接'}
          </button>
          <button type="button" className="soft-button" onClick={handleRebuildRecommendationIndex} disabled={maintainingRecommendation}>
            重建索引
          </button>
          <button type="button" className="soft-button" onClick={handleClearRecommendationData} disabled={maintainingRecommendation}>
            清空推荐数据
          </button>
        </div>
      </div>

      <div className="settings-side-column">
        <div className="settings-card settings-backup-card glass-panel">
          <div className="settings-backup-heading">
            <span className="settings-card-icon"><UploadIcon size={18} /></span>
            <div>
              <h3>数据备份</h3>
              <p>导出收藏、歌单与版本信息；导入前会先校验并展示预览。</p>
            </div>
          </div>
          {pendingImport && (
            <div className="import-preview-card">
              <strong>导入预览</strong>
              <p>当前：{favorites.length} 首收藏 / {playlists.length} 个歌单</p>
              <p>文件：{pendingImport.favoriteCount} 首收藏 / {pendingImport.playlistCount} 个歌单 / {pendingImport.playlistSongCount} 首歌单歌曲</p>
              <div className="panel-actions backup-actions">
                <button type="button" className="primary-button" onClick={() => applyPendingImport('replace')}>覆盖导入</button>
                <button type="button" className="soft-button" onClick={() => applyPendingImport('merge')}>合并导入</button>
                <button type="button" className="soft-button" onClick={() => setPendingImport(null)}>取消</button>
              </div>
            </div>
          )}
          <div className="panel-actions backup-actions">
            <button type="button" className="soft-button" onClick={handleExport}>导出 JSON</button>
            <label className="soft-button">
              导入数据
              <input
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={(event) => {
                  handleFileImport(event.target.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
            </label>
          </div>
        </div>
        <RecommendationTaskProgressCard />
        <StorageOverviewCard {...storageOverview} />
      </div>
    </section>
  );
}
