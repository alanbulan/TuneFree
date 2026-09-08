import { useEffect, useMemo, useState } from 'react';
import { invokeCommand, isTauri } from '../../../core/ipc';
import { usePlayerActions } from '../../../core/contexts/PlayerContext';
import { useToast } from '../../components/ToastHost';
import MotionPanel from '../../components/MotionPanel';
import {
  listOfflineDownloads,
  deleteOfflineDownload,
  subscribeOfflineDownloads,
  formatOfflineSize,
  type OfflineDownloadMeta,
} from '../../../core/services/offlineDownloads';
import { readCachedDownloadDir, writeCachedDownloadDir } from '../../utils/downloadDirCache';
import { describeIpcFailure } from './ipcErrorFeedback';

const itemsPerPage = 10;

const sourceLabels: Record<string, string> = {
  netease: '网易云',
  qq: 'QQ',
  kuwo: '酷我',
};

const losslessQualities = new Set(['flac', 'flac24bit']);
const isLosslessQuality = (quality: string) => losslessQualities.has(quality);

export default function DownloadsView() {
  const { playSong } = usePlayerActions();
  const { showToast } = useToast();
  const [offlineDownloads, setOfflineDownloads] = useState<OfflineDownloadMeta[]>([]);
  const [downloadPath, setDownloadPath] = useState(() => isTauri() ? readCachedDownloadDir() : '');
  const [downloadsPage, setDownloadsPage] = useState(1);

  const totalPages = Math.ceil(offlineDownloads.length / itemsPerPage);
  const paginatedDownloads = useMemo(() => {
    const start = (downloadsPage - 1) * itemsPerPage;
    return offlineDownloads.slice(start, start + itemsPerPage);
  }, [offlineDownloads, downloadsPage]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void listOfflineDownloads().then((items) => {
        if (cancelled) return;
        setOfflineDownloads(items);
        setDownloadsPage((page) => Math.min(page, Math.max(1, Math.ceil(items.length / itemsPerPage))));
      }).catch((error: unknown) => {
        const { message } = describeIpcFailure(error, '读取下载记录失败');
        if (!cancelled && message) showToast(message, 'error');
      });
    };
    refresh();

    if (isTauri()) {
      // localStorage 仅作展示缓存，避免首帧闪烁；生效目录以后端为准。
      void invokeCommand('get_download_dir')
        .then((path) => {
          if (!cancelled) setDownloadPath(path);
        })
        .catch(() => {});
    }

    const unsubscribe = subscribeOfflineDownloads(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [showToast]);

  // 目录重选自身失败时不再挂「重新选择」动作，避免用户被弹窗循环困住。
  const reselectDownloadDir = async () => {
    try {
      const path = await invokeCommand('select_download_dir');
      if (!path) return;
      setDownloadPath(path);
      writeCachedDownloadDir(path);
    } catch (error) {
      const { message, tone } = describeIpcFailure(error, '选择下载目录失败');
      if (message) showToast(message, tone);
    }
  };

  const reportFailure = (error: unknown, fallback: string) => {
    const { message, tone, needsDirectoryReselect } = describeIpcFailure(error, fallback);
    if (!message) return;
    showToast(
      message,
      tone,
      needsDirectoryReselect ? { label: '重新选择', onClick: () => void reselectDownloadDir() } : undefined,
    );
  };

  const handleOpenDownloadDir = async () => {
    if (!downloadPath) return;
    try {
      await invokeCommand('open_download_dir');
    } catch (error) {
      reportFailure(error, '打开下载目录失败');
    }
  };

  const handleDeleteOfflineDownload = async (item: OfflineDownloadMeta) => {
    try {
      await deleteOfflineDownload(item.filename);
      showToast('已删除本地文件', 'success');
    } catch (error) {
      reportFailure(error, '删除失败，请稍后再试');
    }
  };

  return (
    <section>
      <div className="content-card glass-panel downloads-summary-card">
        <div className="panel-label-row downloads-summary-row">
          <div className="downloads-summary-main">
            <p className="eyebrow">Offline</p>
            <h2 className="section-title">离线条目（{offlineDownloads.length}）</h2>
            <p className="downloads-summary-desc">
              下载的音频文件直接保存在本地目录，播放时优先读取磁盘文件。如果在外部删除了文件，列表会自动同步。
            </p>
            {downloadPath && (
              <div className="download-path-row">
                <span className="download-path-text">
                  当前本地下载目录：<strong>{downloadPath}</strong>
                </span>
                <button
                  type="button"
                  className="soft-button download-path-button"
                  onClick={handleOpenDownloadDir}
                >
                  打开文件夹
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {offlineDownloads.length === 0 ? (
        <div className="content-card glass-panel">
          <p className="muted-text">暂无离线条目</p>
        </div>
      ) : (
        <>
          <MotionPanel transitionKey={String(downloadsPage)} className="content-card glass-panel downloads-table-card">
            <div className="song-table-container" role="region" aria-label="离线下载列表" tabIndex={0}>
              <table className="song-table offline-download-table">
                <thead>
                  <tr>
                    <th>歌曲</th>
                    <th>歌手</th>
                    <th>音质</th>
                    <th>大小</th>
                    <th>下载时间</th>
                    <th className="is-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedDownloads.map((item) => (
                    <tr key={item.filename} className="offline-download-row">
                      <td>
                        <div className="offline-download-title">
                          <span className="source-badge">{sourceLabels[item.song.source] ?? item.song.source}</span>
                          <strong>{item.song.name}</strong>
                        </div>
                      </td>
                      <td className="offline-download-artist">{item.song.artist}</td>
                      <td>
                        <span className={`offline-quality-badge ${isLosslessQuality(item.quality) ? 'is-lossless' : ''}`}>
                          {item.quality === 'flac24bit' ? 'Hi-Res' : item.quality.toUpperCase()}
                        </span>
                      </td>
                      <td className="offline-download-size">{formatOfflineSize(item.size)}</td>
                      <td className="offline-download-time">{new Date(item.createTime).toLocaleString()}</td>
                      <td className="is-actions">
                        <div className="offline-download-actions">
                          <button type="button" className="soft-button" onClick={() => void playSong(item.song)}>播放</button>
                          <button type="button" className="danger-button" onClick={() => void handleDeleteOfflineDownload(item)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </MotionPanel>

          {totalPages > 1 && (
            <div className="downloads-pagination">
              <button
                type="button"
                className="soft-button"
                disabled={downloadsPage === 1}
                onClick={() => setDownloadsPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </button>
              <span className="downloads-pagination-status">
                第 {downloadsPage} / {totalPages} 页
              </span>
              <button
                type="button"
                className="soft-button"
                disabled={downloadsPage === totalPages}
                onClick={() => setDownloadsPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
