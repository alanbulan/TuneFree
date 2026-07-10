import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePlayerActions } from '../../../core/contexts/PlayerContext';
import { useToast } from '../../components/ToastHost';
import {
  listOfflineDownloads,
  deleteOfflineDownload,
  subscribeOfflineDownloads,
  formatOfflineSize,
  type OfflineDownloadMeta,
} from '../../../core/services/offlineDownloads';

const itemsPerPage = 10;

export default function DownloadsView() {
  const { playSong } = usePlayerActions();
  const { showToast } = useToast();
  const [offlineDownloads, setOfflineDownloads] = useState<OfflineDownloadMeta[]>([]);
  const [downloadPath, setDownloadPath] = useState('');
  const [downloadsPage, setDownloadsPage] = useState(1);

  const totalPages = Math.ceil(offlineDownloads.length / itemsPerPage);
  const paginatedDownloads = useMemo(() => {
    const start = (downloadsPage - 1) * itemsPerPage;
    return offlineDownloads.slice(start, start + itemsPerPage);
  }, [offlineDownloads, downloadsPage]);

  useEffect(() => {
    if (downloadsPage > totalPages && totalPages > 0) {
      setDownloadsPage(totalPages);
    } else if (totalPages === 0 && downloadsPage > 1) {
      setDownloadsPage(1);
    }
  }, [totalPages, downloadsPage]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void listOfflineDownloads().then((items) => {
        if (!cancelled) setOfflineDownloads(items);
      });
    };
    refresh();

    const isTauri =
      typeof window !== 'undefined' &&
      '__TAURI_INTERNALS__' in window;
    if (isTauri) {
      const savedDir = localStorage.getItem('tunefree_download_dir');
      if (savedDir) {
        setDownloadPath(savedDir);
      } else {
        invoke<string>('get_default_download_dir')
          .then((path) => {
            if (!cancelled) setDownloadPath(path);
          })
          .catch(() => {});
      }
    }

    const unsubscribe = subscribeOfflineDownloads(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handleOpenDownloadDir = async () => {
    if (!downloadPath) return;
    try {
      const customDir = localStorage.getItem('tunefree_download_dir') || null;
      await invoke('open_download_dir', { customDir });
    } catch {
      showToast('打开下载目录失败', 'error');
    }
  };

  const handleDeleteOfflineDownload = async (item: OfflineDownloadMeta) => {
    try {
      await deleteOfflineDownload(item.filename);
      showToast('已删除本地文件', 'success');
    } catch {
      showToast('删除失败，请稍后再试', 'error');
    }
  };

  return (
    <section>
      <div className="content-card glass-panel" style={{ marginBottom: 14 }}>
        <div className="panel-label-row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="eyebrow">Offline</p>
            <h2 className="section-title">离线条目（{offlineDownloads.length}）</h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-soft)', lineHeight: 1.6, margin: '8px 0 0 0' }}>
              下载的音频文件直接保存在本地目录，播放时优先读取磁盘文件。如果在外部删除了文件，列表会自动同步。
            </p>
            {downloadPath && (
              <div className="download-path-row" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)', wordBreak: 'break-all' }}>
                  当前本地下载目录：<strong>{downloadPath}</strong>
                </span>
                <button
                  type="button"
                  className="soft-button"
                  style={{ padding: '2px 8px', fontSize: '0.75rem', borderRadius: '6px' }}
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
          <div className="content-card glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="song-table-container">
              <table className="song-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                    <th style={{ padding: '12px 16px', color: 'var(--muted)', fontWeight: 600, fontSize: '0.85rem' }}>歌曲</th>
                    <th style={{ padding: '12px 16px', color: 'var(--muted)', fontWeight: 600, fontSize: '0.85rem' }}>歌手</th>
                    <th style={{ padding: '12px 16px', color: 'var(--muted)', fontWeight: 600, fontSize: '0.85rem' }}>音质</th>
                    <th style={{ padding: '12px 16px', color: 'var(--muted)', fontWeight: 600, fontSize: '0.85rem' }}>大小</th>
                    <th style={{ padding: '12px 16px', color: 'var(--muted)', fontWeight: 600, fontSize: '0.85rem' }}>下载时间</th>
                    <th style={{ padding: '12px 16px', color: 'var(--muted)', fontWeight: 600, fontSize: '0.85rem', textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedDownloads.map((item) => (
                    <tr
                      key={item.filename}
                      style={{ borderBottom: '1px solid var(--line)', transition: 'background 0.2s' }}
                      className="offline-download-row"
                    >
                      <td style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="source-badge" style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(var(--accent-rgb), 0.08)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb), 0.15)', fontWeight: 600 }}>
                          {item.song.source === 'netease' ? '网易云' : item.song.source === 'qq' ? 'QQ' : item.song.source === 'kuwo' ? '酷我' : item.song.source}
                        </span>
                        <span style={{ fontWeight: 500 }}>{item.song.name}</span>
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-soft)' }}>{item.song.artist}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: item.quality === 'flac24bit' || item.quality === 'flac' ? 'rgba(var(--accent-rgb), 0.1)' : 'rgba(100, 116, 139, 0.1)',
                          color: item.quality === 'flac24bit' || item.quality === 'flac' ? 'var(--accent)' : 'var(--text-soft)',
                        }}>
                          {item.quality === 'flac24bit' ? 'Hi-Res' : item.quality.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--muted)' }}>{formatOfflineSize(item.size)}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--faint)', fontSize: '0.85rem' }}>
                        {new Date(item.create_time).toLocaleString()}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                          <button type="button" className="soft-button" onClick={() => void playSong(item.song)}>播放</button>
                          <button type="button" className="danger-button" onClick={() => void handleDeleteOfflineDownload(item)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '12px',
              marginTop: '16px',
              padding: '8px 0',
            }}>
              <button
                type="button"
                className="soft-button"
                disabled={downloadsPage === 1}
                onClick={() => setDownloadsPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </button>
              <span style={{ fontSize: '0.9rem', color: 'var(--muted)', fontWeight: 500 }}>
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
