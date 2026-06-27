import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BoxesIcon, SettingsIcon, UploadIcon } from '../../../core/components/Icons';
import { useLibrary, type LibraryImportMode, type LibraryImportPreview } from '../../../core/contexts/LibraryContext';
import { useDesktopPreferences, type CloseBehavior } from '../../../core/contexts/DesktopPreferencesContext';
import { useTheme } from '../../../core/contexts/ThemeContext';
import { useToast } from '../../components/ToastHost';
import CustomSelect from './components/CustomSelect';

const closeBehaviorOptions: Array<{ label: string; value: CloseBehavior; hint: string }> = [
  { label: '每次询问', value: 'ask', hint: '关闭时弹出选择，可临时决定后台运行或退出。' },
  { label: '最小化到托盘', value: 'tray', hint: '关闭主窗口后继续后台播放，可从托盘恢复。' },
  { label: '退出应用', value: 'exit', hint: '关闭主窗口时彻底退出，桌面歌词也会关闭。' },
];

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

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setTempShowPet(localStorage.getItem('tunefree_desktop_show_pet') !== 'false');
    }
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
          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            {[
              { name: '玫瑰红', value: 'red', color: '#fa233b' },
              { name: '星海蓝', value: 'blue', color: '#007aff' },
              { name: '极光绿', value: 'green', color: '#34c759' },
              { name: '丁香紫', value: 'purple', color: '#af52de' },
              { name: '活力橙', value: 'orange', color: '#ff9500' },
            ].map((color) => (
              <button
                key={color.value}
                type="button"
                title={color.name}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: color.color,
                  border: themeColor === color.value ? '2.5px solid var(--text)' : '1px solid rgba(0,0,0,0.1)',
                  boxShadow: themeColor === color.value ? `0 0 10px ${color.color}` : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  transform: themeColor === color.value ? 'scale(1.15)' : 'scale(1)',
                }}
                onClick={() => setThemeColor(color.value as 'red' | 'blue' | 'green' | 'purple' | 'orange')}
              />
            ))}
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

      <div className="settings-card settings-backup-card glass-panel">
        <span className="settings-card-icon"><UploadIcon size={22} /></span>
        <h3>数据备份</h3>
        <p>收藏与本地歌单都保存在浏览器本地；导出的 JSON 会包含版本号、导出时间、收藏列表和歌单列表。</p>
        <div className="backup-detail-list">
          <span>同一 localStorage key 可在桌面端与移动 PWA 间迁移</span>
          <span>导入前会先校验 JSON 并展示预览，不会静默覆盖现有数据</span>
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
    </section>
  );
}
