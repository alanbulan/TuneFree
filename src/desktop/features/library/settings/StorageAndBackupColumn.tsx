import { UploadIcon } from '../../../../core/components/Icons';
import RecommendationTaskProgressCard from '../components/RecommendationTaskProgressCard';
import StorageOverviewCard from '../components/StorageOverviewCard';
import type { SettingsViewModel } from './useSettingsViewModel';

export default function StorageAndBackupColumn({ model }: { model: SettingsViewModel['backup'] }) {
  return (
    <div className="settings-side-column">
      <div className="settings-card settings-backup-card glass-panel">
        <div className="settings-backup-heading">
          <span className="settings-card-icon"><UploadIcon size={18} /></span>
          <div>
            <h3>数据备份</h3>
            <p>导出收藏、歌单与版本信息；导入前会先校验并展示预览。</p>
          </div>
        </div>
        {model.pendingImport && (
          <div className="import-preview-card">
            <strong>导入预览</strong>
            <p>当前：{model.favorites.length} 首收藏 / {model.playlists.length} 个歌单</p>
            <p>
              文件：{model.pendingImport.favoriteCount} 首收藏 / {model.pendingImport.playlistCount} 个歌单 / {model.pendingImport.playlistSongCount} 首歌单歌曲
            </p>
            <div className="panel-actions backup-actions">
              <button type="button" className="primary-button" onClick={() => void model.applyPendingImport('replace')}>覆盖导入</button>
              <button type="button" className="soft-button" onClick={() => void model.applyPendingImport('merge')}>合并导入</button>
              <button type="button" className="soft-button" onClick={() => model.setPendingImport(null)}>取消</button>
            </div>
          </div>
        )}
        <div className="panel-actions backup-actions">
          <button type="button" className="soft-button" onClick={model.exportLibrary}>导出 JSON</button>
          <label className="soft-button">
            导入数据
            <input
              type="file"
              accept=".json"
              className="hidden-file-input"
              onChange={(event) => {
                model.importFile(event.target.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>
      </div>
      <RecommendationTaskProgressCard />
      <StorageOverviewCard {...model.storageOverview} />
    </div>
  );
}
