import { BoxesIcon } from '../../../../core/components/Icons';
import ColorPalette from '../components/ColorPalette';
import CustomSelect from '../components/CustomSelect';
import type { SettingsViewModel } from './useSettingsViewModel';
import { useId } from 'react';
import MotionChoice from '../../../components/MotionChoice';

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

const lyricDisplayModes = [
  { label: '逐行显示', value: 'line' as const },
  { label: '逐字动态', value: 'karaoke' as const },
];

export default function AppearanceSettingsCard({ model }: { model: SettingsViewModel['appearance'] }) {
  const indicatorId = useId();
  return (
    <div className="settings-card settings-theme-card glass-panel">
      <h3><BoxesIcon size={18} /> 个性化与歌词</h3>
      <div className="panel-field settings-field-block">
        <label>主题模式</label>
        <div className="settings-option-row">
          {themeModes.map((mode) => (
            <MotionChoice
              key={mode.value}
              type="button"
              className="soft-button settings-toggle-button" selected={model.themeMode === mode.value} indicatorId={`${indicatorId}-theme`}
              onClick={() => model.setThemeMode(mode.value)}
            >
              {mode.label}
            </MotionChoice>
          ))}
        </div>
      </div>
      <div className="panel-field settings-field-block">
        <label>强调主题色</label>
        <div className="settings-field-inset is-loose">
          <ColorPalette value={model.themeColor} onChange={model.setThemeColor} />
        </div>
      </div>
      <div className="panel-field settings-field-block">
        <label>歌词字号大小 ({model.lyricSize}px)</label>
        <div className="settings-slider-row">
          <span className="settings-slider-hint">小</span>
          <input
            type="range"
            className="settings-range"
            min="14"
            max="36"
            value={model.lyricSize}
            onChange={(event) => model.setLyricSize(parseInt(event.target.value))}
          />
          <span className="settings-slider-hint is-large">大</span>
        </div>
      </div>
      <div className="panel-field settings-field-block">
        <label>歌词字体</label>
        <div className="settings-field-inset">
          <CustomSelect value={model.lyricFont} options={lyricFonts} onChange={model.setLyricFont} />
        </div>
      </div>
      <div className="panel-field settings-field-block">
        <label>歌词显示方式</label>
        <div className="settings-option-row is-wrap">
          {lyricDisplayModes.map((option) => (
            <MotionChoice
              key={option.value}
              type="button"
              className="soft-button settings-toggle-button" selected={model.lyricDisplayMode === option.value} indicatorId={`${indicatorId}-lyrics`}
              onClick={() => model.changeLyricDisplayMode(option.value, option.label)}
            >
              {option.label}
            </MotionChoice>
          ))}
        </div>
        <p className="settings-note">
          逐行显示为原有歌词加载方式；逐字动态只在歌词源提供真实逐字时间轴时生效。
        </p>
      </div>
      <div className="panel-field settings-field-divider">
        <label>桌面悬浮歌词</label>
        <div className="settings-checkbox-group">
          <div className="settings-checkbox-row">
            <input
              type="checkbox"
              id="show-lyric-toggle"
              className="settings-checkbox"
              checked={model.showDesktopLyric}
              onChange={(event) => model.setShowDesktopLyric(event.target.checked)}
            />
            <label htmlFor="show-lyric-toggle" className="settings-checkbox-label">启用桌面歌词</label>
          </div>
          <div className="settings-checkbox-row">
            <input
              type="checkbox"
              id="lock-lyric-toggle"
              className="settings-checkbox"
              checked={model.lockDesktopLyric}
              onChange={(event) => {
                const locked = event.target.checked;
                model.setLockDesktopLyric(locked);
                model.showToast(locked ? '桌面歌词已锁定（鼠标穿透）' : '桌面歌词已解锁', 'success');
              }}
            />
            <label htmlFor="lock-lyric-toggle" className="settings-checkbox-label">锁定桌面歌词</label>
          </div>
        </div>
        <p className="settings-note is-loose">
          锁定状态下鼠标将 100% 穿透歌词悬浮窗。若要解锁，请右击底部播放栏的「LRC」按钮。
        </p>
      </div>
    </div>
  );
}
