import { SettingsIcon } from '../../../../core/components/Icons';
import type { CloseBehavior } from '../../../../core/contexts/DesktopPreferencesContext';
import type { SettingsViewModel } from './useSettingsViewModel';

const closeBehaviorOptions: Array<{ label: string; value: CloseBehavior; hint: string }> = [
  { label: '每次询问', value: 'ask', hint: '关闭时弹出选择，可临时决定后台运行或退出。' },
  { label: '最小化到托盘', value: 'tray', hint: '关闭主窗口后继续后台播放，可从托盘恢复。' },
  { label: '退出应用', value: 'exit', hint: '关闭主窗口时彻底退出，桌面歌词也会关闭。' },
];

export default function DownloadSettingsCard({ model }: { model: SettingsViewModel['core'] }) {
  const activeCloseBehavior = closeBehaviorOptions.find((option) => option.value === model.closeBehavior);

  return (
    <div className="settings-card settings-core-card glass-panel">
      <h3><SettingsIcon size={18} /> 核心设置</h3>
      <div className="panel-field">
        <label>CORS 代理</label>
        <input
          className="panel-input"
          placeholder="留空使用内置代理（推荐）"
          value={model.tempProxy}
          onChange={(event) => model.setTempProxy(event.target.value)}
        />
      </div>
      <div className="panel-field" style={{ marginTop: '14px' }}>
        <label>本地下载目录</label>
        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
          <input className="panel-input" style={{ flex: 1 }} readOnly value={model.downloadPath} placeholder="获取下载路径中..." />
          <button type="button" className="soft-button" style={{ whiteSpace: 'nowrap' }} onClick={() => void model.selectDownloadDir()}>
            更改目录
          </button>
          <button type="button" className="soft-button" style={{ whiteSpace: 'nowrap' }} onClick={() => void model.resetDownloadDir()}>
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
          {closeBehaviorOptions.map((option) => {
            const active = model.closeBehavior === option.value;
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
                onClick={() => {
                  model.setCloseBehavior(option.value);
                  model.showToast(`关闭行为已设置为：${option.label}`, 'success');
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '6px', lineHeight: 1.4 }}>
          {activeCloseBehavior?.hint}
        </p>
      </div>
      <div className="panel-field" style={{ marginTop: '14px' }}>
        <label>安和昴 (486) 桌宠</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
          <input
            type="checkbox"
            id="pet-toggle"
            style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent)' }}
            checked={model.tempShowPet}
            onChange={(event) => model.setTempShowPet(event.target.checked)}
          />
          <label htmlFor="pet-toggle" style={{ fontSize: '14px', cursor: 'pointer', userSelect: 'none', color: 'var(--text)' }}>
            启用桌面宠物
          </label>
        </div>
      </div>
      <div className="settings-save-row">
        <button type="button" className="primary-button" onClick={model.saveCoreSettings}>保存配置</button>
      </div>
    </div>
  );
}
