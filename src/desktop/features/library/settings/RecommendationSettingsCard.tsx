import { BrainCircuit, RefreshCw } from 'lucide-react';
import type { SettingsViewModel } from './useSettingsViewModel';
import MotionDisclosure from '../../../components/MotionDisclosure';
import CustomSelect from '../components/CustomSelect';

export default function RecommendationSettingsCard({ model }: { model: SettingsViewModel['recommendation'] }) {
  const updateConfig = (values: Partial<typeof model.llmConfig>) => {
    model.setLlmConfig((previous) => ({ ...previous, ...values }));
  };

  return (
    <div className="settings-card settings-core-card glass-panel">
      <h3><BrainCircuit size={18} /> 音乐推荐</h3>
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
            根据播放与收藏发现好音乐
          </label>
        </div>
      </div>
      <div className="panel-field">
        <label>AI 精选</label>
        <div className="settings-checkbox-row">
          <input
            type="checkbox"
            id="llm-recommendation-toggle"
            className="settings-checkbox"
            checked={model.llmConfig.enabled}
            onChange={(event) => updateConfig({ enabled: event.target.checked })}
          />
          <label htmlFor="llm-recommendation-toggle" className="settings-checkbox-label">
            使用已配置的模型发现和精选音乐
          </label>
        </div>
      </div>
      <div className="panel-field">
        <label htmlFor="llm-base-url">API 根地址</label>
        <input id="llm-base-url" className="panel-input" placeholder="https://api.openai.com/v1" value={model.llmConfig.baseUrl} onChange={(event) => updateConfig({ baseUrl: event.target.value })} />
      </div>
      <div className="panel-field">
        <label htmlFor="llm-api-key">API Key</label>
        <input
          id="llm-api-key"
          className="panel-input"
          type="password"
          placeholder={model.llmConfig.hasApiKey ? '已保存，留空保持不变' : '输入服务商提供的 API Key'}
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
      <div className="panel-field">
        <label htmlFor="llm-model">模型</label>
        <div className="settings-model-picker">
          <CustomSelect id="llm-model" value={model.llmConfig.model}
            disabled={!model.llmConfig.model && model.modelList.models.length === 0}
            onChange={(value) => updateConfig({ model: value })}
            options={[
              { value: '', label: model.modelList.models.length ? '选择模型' : '先获取模型列表', disabled: true },
              ...(model.llmConfig.model && !model.modelList.models.includes(model.llmConfig.model)
                ? [{ value: model.llmConfig.model, label: `${model.llmConfig.model}（当前配置）` }] : []),
              ...model.modelList.models.map((name) => ({ label: name, value: name })),
            ]} />
          <button type="button" className="soft-button" onClick={() => void model.modelList.fetchModels()}
            disabled={model.modelList.loading || !model.llmConfig.baseUrl.trim()
              || (!model.apiKey.trim() && (!model.llmConfig.hasApiKey || model.clearApiKey))}>
            <RefreshCw size={14} aria-hidden="true" />
            {model.modelList.loading ? '获取中…' : model.modelList.models.length ? '刷新列表' : '获取列表'}
          </button>
        </div>
        <p className="settings-note" role="status">
          {model.modelList.models.length
            ? `已从服务商获取 ${model.modelList.models.length} 个模型`
            : '填写服务地址和密钥后，从服务商的模型列表中选择。'}
        </p>
        {model.modelList.error && <p className="settings-error-text" role="alert">{model.modelList.error}</p>}
      </div>
      <MotionDisclosure label="高级参数">
        <div className="settings-number-grid">
          <div className="panel-field">
            <label>超时（毫秒）</label>
            <input className="panel-input" type="number" min={1000} max={60000} value={model.llmConfig.timeoutMs} onChange={(event) => updateConfig({ timeoutMs: Number(event.target.value) })} />
          </div>
          <div className="panel-field">
            <label>候选上限</label>
            <input className="panel-input" type="number" min={1} max={120} value={model.llmConfig.maxCandidates} onChange={(event) => updateConfig({ maxCandidates: Number(event.target.value) })} />
          </div>
          <div className="panel-field">
            <label>缓存（秒）</label>
            <input className="panel-input" type="number" min={60} value={model.llmConfig.cacheTtlSeconds} onChange={(event) => updateConfig({ cacheTtlSeconds: Number(event.target.value) })} />
          </div>
        </div>
      </MotionDisclosure>
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
      {model.initializing && (
        <p className="settings-note">推荐服务正在初始化，稍后会自动重试。</p>
      )}
      {model.llmConfig.lastError && (
        <p className="settings-error-text">{model.llmConfig.lastError}</p>
      )}
      <div className="panel-actions backup-actions">
        <button type="button" className="primary-button" onClick={() => void model.saveRecommendationSettings()} disabled={model.savingLlm}>
          {model.savingLlm ? '保存中…' : '保存配置'}
        </button>
        <button type="button" className="soft-button" onClick={() => void model.testProvider()} disabled={model.testingLlm}>
          {model.testingLlm ? '测试中' : '测试连接'}
        </button>
      </div>
      <MotionDisclosure label="推荐数据管理" className="settings-maintenance">
        <div className="panel-actions">
          <button type="button" className="soft-button" onClick={() => void model.maintainRecommendation('rebuild')} disabled={model.maintainingRecommendation}>重建索引</button>
          <button type="button" className="danger-button" onClick={() => void model.maintainRecommendation('clear')} disabled={model.maintainingRecommendation}>清空推荐数据</button>
        </div>
      </MotionDisclosure>
    </div>
  );
}
