import { BoxesIcon } from '../../../../core/components/Icons';
import ColorPalette from '../components/ColorPalette';
import CustomSelect from '../components/CustomSelect';
import type { SettingsViewModel } from './useSettingsViewModel';

const themeModes = [
  { label: '浅色模式', value: 'light' as const },
  { label: '深色模式', value: 'dark' as const },
  { label: '跟随系统', value: 'system' as const },
];

const lyricFonts = [
  { label: '系统默认', value: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif' },
  { label: '优雅苹方', value: '"PingFang SC", "Helvetica Neue", sans-serif' },
  { label: '微软雅黑', value: '"Microsoft YaHei", sans-serif' },
  { label: '宋体', value: '"SimSun", serif' },
  { label: '华文细黑', value: '"STXihei", "STHeiti", sans-serif' },
];

export default function AppearanceSettingsCard({ model }: { model: SettingsViewModel['appearance'] }) {
  return (
    <div className="settings-card settings-theme-card glass-panel">
      <h3><BoxesIcon size={18} /> 个性化与歌词</h3>
      <div className="panel-field" style={{ marginTop: '14px' }}>
        <label>主题模式</label>
        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
          {themeModes.map((mode) => {
            const active = model.themeMode === mode.value;
            return (
              <button
                key={mode.value}
                type="button"
                className={`soft-button ${active ? 'active' : ''}`}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  borderRadius: '8px',
                  backgroundColor: active ? 'var(--accent)' : 'transparent',
                  color: active ? 'var(--ios-card)' : 'var(--text)',
                  border: active ? '1px solid var(--accent)' : '1px solid var(--line)',
                  fontWeight: active ? 700 : 500,
                }}
                onClick={() => model.setThemeMode(mode.value)}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="panel-field" style={{ marginTop: '14px' }}>
        <label>强调主题色</label>
        <div style={{ marginTop: '8px' }}><ColorPalette value={model.themeColor} onChange={model.setThemeColor} /></div>
      </div>
      <div className="panel-field" style={{ marginTop: '14px' }}>
        <label>歌词字号大小 ({model.lyricSize}px)</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
          <span style={{ fontSize: '11px', opacity: 0.6 }}>小</span>
          <input
            type="range"
            min="14"
            max="36"
            value={model.lyricSize}
            onChange={(event) => model.setLyricSize(parseInt(event.target.value))}
            style={{ flex: 1, accentColor: 'var(--accent)' }}
          />
          <span style={{ fontSize: '15px', fontWeight: 600 }}>大</span>
        </div>
      </div>
      <div className="panel-field" style={{ marginTop: '14px' }}>
        <label>歌词字体</label>
        <div style={{ marginTop: '6px' }}>
          <CustomSelect value={model.lyricFont} options={lyricFonts} onChange={model.setLyricFont} />
        </div>
      </div>
      <div className="panel-field" style={{ marginTop: '14px' }}>
        <label>歌词显示方式</label>
        <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
          {[{ label: '逐行显示', value: 'line' as const }, { label: '逐字动态', value: 'karaoke' as const }].map((option) => {
            const active = model.lyricDisplayMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`soft-button ${active ? 'active' : ''}`}
                style={{
                  flex: '1 1 120px',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  backgroundColor: active ? 'var(--accent)' : 'transparent',
                  color: active ? 'var(--ios-card)' : 'var(--text)',
                  border: active ? '1px solid var(--accent)' : '1px solid var(--line)',
                  fontWeight: active ? 700 : 500,
                }}
                onClick={() => model.changeLyricDisplayMode(option.value, option.label)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '6px', lineHeight: 1.4 }}>
          逐行显示为原有歌词加载方式；逐字动态只在歌词源提供真实逐字时间轴时生效。
        </p>
      </div>
      <div className="panel-field" style={{ marginTop: '16px', borderTop: '1px solid var(--line)', paddingTop: '14px' }}>
        <label>桌面悬浮歌词</label>
        <div style={{ display: 'flex', gap: '20px', marginTop: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="show-lyric-toggle"
              style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent)' }}
              checked={model.showDesktopLyric}
              onChange={(event) => model.setShowDesktopLyric(event.target.checked)}
            />
            <label htmlFor="show-lyric-toggle" style={{ fontSize: '14px', cursor: 'pointer', userSelect: 'none', color: 'var(--text)' }}>启用桌面歌词</label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="lock-lyric-toggle"
              style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent)' }}
              checked={model.lockDesktopLyric}
              onChange={(event) => {
                const locked = event.target.checked;
                model.setLockDesktopLyric(locked);
                model.showToast(locked ? '桌面歌词已锁定（鼠标穿透）' : '桌面歌词已解锁', 'success');
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
  );
}
