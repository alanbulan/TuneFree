import { useRef } from 'react';
import { Link, LoaderCircle } from 'lucide-react';
import { UploadIcon } from '../../../../core/components/Icons';
import type { MusicSourcesViewModel } from './useMusicSourcesViewModel';

/**
 * 顶部工具区：导入控件与音源状态计数并成一行。
 *
 * 原来是两块独立卡片（导入区 + 状态概览），纵向占掉近 200px，把音源详情挤到
 * 首屏之外。状态计数本身就是一行短信息，放在导入控件右侧既够用又不另占一行。
 *
 * 拖拽由 `SourcesView` 的容器统一处理（Tauri 主窗口已关闭原生拖放拦截），
 * 这里只负责把「点击选择文件」和「粘贴链接」两条路径接到视图模型上。
 */
export default function SourceImportPanel({ model }: { model: MusicSourcesViewModel }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { unverified, success, failed } = model.healthCounts;

  return (
    <div className="sources-toolbar" aria-busy={model.importing}>
      <div className="sources-import-actions">
        <button
          type="button"
          className="primary-button sources-import-button"
          disabled={model.importing}
          onClick={() => fileInputRef.current?.click()}
        >
          {model.importing ? <LoaderCircle size={16} className="source-loading-icon" aria-hidden="true" /> : <UploadIcon size={16} />}
          {model.importing ? '正在导入' : '导入文件'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="sources-file-input"
          accept=".js,.txt,.mjs,.cjs,application/javascript,text/javascript"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            void model.importFiles(files);
          }}
        />
        <div className="sources-url-row">
          <Link size={16} aria-hidden="true" />
          <input
            className="sources-url-input"
            type="url"
            value={model.urlInput}
            placeholder="粘贴音源链接，或把 .js 文件拖到本页"
            aria-label="音源脚本链接"
            disabled={model.importing}
            onChange={(event) => model.setUrlInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void model.importFromUrl();
              }
            }}
          />
          <button
            type="button"
            className="soft-button sources-link-button"
            aria-label="链接导入"
            disabled={model.importing || model.urlInput.trim().length === 0}
            onClick={() => void model.importFromUrl()}
          >
            导入
          </button>
        </div>
      </div>
      <div className="sources-health-inline" aria-label="音源状态概览">
        <span className="is-unverified"><strong>{unverified}</strong>已加载 · 待验证</span>
        <span className="is-success"><strong>{success}</strong>最近解析成功</span>
        <span className="is-failed"><strong>{failed}</strong>需要关注</span>
      </div>
    </div>
  );
}
