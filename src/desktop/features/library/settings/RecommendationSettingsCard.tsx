import { SettingsIcon } from '../../../../core/components/Icons';
import type { SettingsViewModel } from './useSettingsViewModel';
import { formatBytes } from './useStorageOverview';

export default function RecommendationSettingsCard({ model }: { model: SettingsViewModel['recommendation'] }) {
  const updateConfig = (values: Partial<typeof model.llmConfig>) => {
    model.setLlmConfig((previous) => ({ ...previous, ...values }));
  };

  return (
    <div className="settings-card settings-core-card glass-panel">
      <h3><SettingsIcon size={18} /> 推荐系统</h3>
      <div className="panel-field">
        <label>本地推荐</label>
        <div className="settings-checkbox-row">
          <input
            type="checkbox"
            id="local-recommendation-toggle"
            className="settings-checkbox"
            checked={model.localRecommendationEnabled}
            onChange={(event) => model.setLocalRecommendationEnabled(event.target.checked)}
          />
          <label htmlFor="local-recommendation-toggle" className="settings-checkbox-label">
            启用本地推荐
          </label>
        </div>
      </div>
      <div className="panel-field">
        <label>云端发现与重排</label>
        <div className="settings-checkbox-row">
          <input
            type="checkbox"
            id="llm-recommendation-toggle"
            className="settings-checkbox"
            checked={model.llmConfig.enabled}
            onChange={(event) => updateConfig({ enabled: event.target.checked })}
          />
          <label htmlFor="llm-recommendation-toggle" className="settings-checkbox-label">
            启用 OpenAI 兼容模型发现与重排
          </label>
        </div>
      </div>
      <div className="panel-field">
        <label>API 根地址</label>
        <input className="panel-input" placeholder="https://api.openai.com/v1" value={model.llmConfig.baseUrl} onChange={(event) => updateConfig({ baseUrl: event.target.value })} />
      </div>
      <div className="panel-field">
        <label>模型名</label>
        <input className="panel-input" placeholder="例如 gpt-4.1-mini" value={model.llmConfig.model} onChange={(event) => updateConfig({ model: event.target.value })} />
      </div>
      <div className="panel-field">
        <label>API Key</label>
        <input
          className="panel-input"
          type="password"
          placeholder={model.llmConfig.hasApiKey ? '已保存，留空保持不变' : '保存到本地配置'}
          value={model.apiKey}
          onChange={(event) => model.setApiKey(event.target.value)}
        />
        <div className="settings-checkbox-row">
          <input
            type="checkbox"
            id="clear-llm-key"
            className="settings-checkbox is-small"
            checked={model.clearApiKey}
            onChange={(event) => model.setClearApiKey(event.target.checked)}
          />
          <label htmlFor="clear-llm-key" className="settings-checkbox-label is-small">
            清除已保存密钥
          </label>
        </div>
      </div>
      <div className="settings-number-grid">
        <div className="panel-field">
          <label>超时 ms</label>
          <input className="panel-input" type="number" min={1000} max={60000} value={model.llmConfig.timeoutMs} onChange={(event) => updateConfig({ timeoutMs: Number(event.target.value) })} />
        </div>
        <div className="panel-field">
          <label>候选上限</label>
          <input className="panel-input" type="number" min={1} max={120} value={model.llmConfig.maxCandidates} onChange={(event) => updateConfig({ maxCandidates: Number(event.target.value) })} />
        </div>
        <div className="panel-field">
          <label>缓存秒数</label>
          <input className="panel-input" type="number" min={60} value={model.llmConfig.cacheTtlSeconds} onChange={(event) => updateConfig({ cacheTtlSeconds: Number(event.target.value) })} />
        </div>
      </div>
      <div className="panel-field">
        <label>隐私</label>
        <div className="settings-checkbox-row">
          <input
            type="checkbox"
            id="upload-recent-events"
            className="settings-checkbox is-small"
            checked={model.llmConfig.uploadRecentEvents}
            onChange={(event) => updateConfig({ uploadRecentEvents: event.target.checked })}
          />
          <label htmlFor="upload-recent-events" className="settings-checkbox-label is-small">
            允许上传最近少量事件摘要
          </label>
        </div>
        <p className="settings-note">
          云端发现与重排始终会发送候选歌曲元数据和画像摘要；关闭后仅不附带最近事件摘要。
        </p>
      </div>
      <div className="backup-detail-list settings-inline-detail-list">
        <span>推荐数据库：{formatBytes(model.llmConfig.databaseSizeBytes)}</span>
        <span>模型缓存：{model.llmConfig.llmCacheEntries} 条</span>
        <span>密钥状态：{model.llmConfig.hasApiKey ? '已保存到本地配置' : '未保存'}</span>
      </div>
      {model.initializing && (
        <p className="settings-note">推荐服务正在初始化，稍后会自动重试。</p>
      )}
      {model.llmConfig.lastError && (
        <p className="settings-error-text">{model.llmConfig.lastError}</p>
      )}
      <div className="panel-actions backup-actions">
        <button type="button" className="primary-button" onClick={() => void model.saveRecommendationSettings()} disabled={model.savingLlm}>
          {model.savingLlm ? '保存中' : '保存推荐配置'}
        </button>
        <button type="button" className="soft-button" onClick={() => void model.testProvider()} disabled={model.testingLlm}>
          {model.testingLlm ? '测试中' : '测试连接'}
        </button>
        <button type="button" className="soft-button" onClick={() => void model.maintainRecommendation('rebuild')} disabled={model.maintainingRecommendation}>重建索引</button>
        <button type="button" className="soft-button" onClick={() => void model.maintainRecommendation('clear')} disabled={model.maintainingRecommendation}>清空推荐数据</button>
      </div>
    </div>
  );
}
