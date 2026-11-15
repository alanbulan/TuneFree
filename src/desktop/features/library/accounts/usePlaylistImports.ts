import { useEffect, useRef, useState } from 'react';
import { useLibrary } from '../../../../core/contexts/LibraryContext';
import { toIpcError, type AccountPlatform, type PlatformAccount, type PlatformPlaylist } from '../../../../core/ipc';
import { importedPlatformSongs, platformAccounts } from '../../../../core/services/platformAccounts';
import { useDesktopDialog } from '../../../components/DialogHost';
import { useToast } from '../../../components/ToastHost';

export interface PlaylistImportStatus {
  playlist: PlatformPlaylist;
  state: 'queued' | 'importing' | 'success' | 'failed' | 'cancelled';
  message: string;
}

export function usePlaylistImports(account: PlatformAccount, markExpired: (platform: AccountPlatform) => void) {
  const { playlists: local, createPlaylist } = useLibrary();
  const { confirmDialog } = useDesktopDialog();
  const { showToast } = useToast();
  const [statuses, setStatuses] = useState<Record<string, PlaylistImportStatus>>({});
  const [progress, setProgress] = useState({ completed: 0, total: 0, running: false });
  const [prompting, setPrompting] = useState(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const active = useRef<number | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);

  const cancel = () => {
    generation.current += 1; active.current = null; setPrompting(false);
    setProgress((previous) => ({ ...previous, running: false }));
    setStatuses((previous) => Object.fromEntries(Object.entries(previous).map(([id, item]) =>
      [id, item.state === 'queued' || item.state === 'importing' ? { ...item, state: 'cancelled', message: '已停止，未导入' } : item])));
  };

  const start = async (requested: PlatformPlaylist[]) => {
    if (active.current !== null || account.state === 'expired' || requested.length === 0) return;
    const playlists = [...new Map(requested.map((item) => [item.id, item])).values()];
    const version = ++generation.current;
    active.current = version;
    const valid = () => mounted.current && version === generation.current;
    let successes = 0, failures = 0;
    const update = (playlist: PlatformPlaylist, state: PlaylistImportStatus['state'], message = '') => {
      setStatuses((previous) => ({ ...previous, [playlist.id]: { playlist, state, message } }));
    };
    try {
      const names = new Set(local.map((item) => item.name));
      const duplicates = playlists.filter((item) => { const exists = names.has(item.name); names.add(item.name); return exists; });
      if (duplicates.length) {
        setPrompting(true);
        const confirmed = await confirmDialog({ title: playlists.length === 1 ? '已有同名歌单' : '包含同名歌单',
          message: playlists.length === 1 ? `「${playlists[0].name}」已存在，是否再导入一份新的本地副本？`
            : `其中 ${duplicates.length} 个歌单与本地或本次选择同名。继续将各自保存为新的本地副本，是否导入这 ${playlists.length} 个歌单？`,
          confirmLabel: playlists.length === 1 ? '再导入一份' : '继续批量导入' });
        if (!valid() || !confirmed) return;
      }
      if (!valid()) return;
      setPrompting(false);
      setProgress({ completed: 0, total: playlists.length, running: true });
      setStatuses((previous) => ({ ...previous, ...Object.fromEntries(playlists.map((playlist) =>
        [playlist.id, { playlist, state: 'queued' as const, message: '等待导入' }])) }));
      for (const playlist of playlists) {
        if (!valid()) return;
        update(playlist, 'importing', '导入中…');
        try {
          const payload = await platformAccounts.import(account.platform, playlist.id);
          if (!valid()) return;
          const songs = importedPlatformSongs(payload);
          if (!createPlaylist(payload.name, songs)) throw new Error('本地歌单保存失败，请检查存储空间后重试');
          successes += 1;
          const unavailable = payload.unavailableCount ? `，${payload.unavailableCount} 首已下架或不可见` : '';
          update(playlist, 'success', `已导入 ${songs.length} 首${unavailable}`);
          if (playlists.length === 1) showToast(`已导入「${payload.name}」共 ${songs.length} 首${unavailable}，可在「歌单」中打开`, 'success');
        } catch (error) {
          if (!valid()) return;
          failures += 1;
          const failure = toIpcError(error);
          update(playlist, 'failed', failure.message);
          if (playlists.length === 1) showToast(failure.message, 'error');
          if (failure.code === 'AUTH_REQUIRED') {
            setStatuses((previous) => Object.fromEntries(Object.entries(previous).map(([id, item]) =>
              [id, item.state === 'queued' ? { ...item, state: 'cancelled', message: '账号已失效，未导入' } : item])));
            setProgress({ completed: successes + failures, total: playlists.length, running: false });
            if (playlists.length > 1) showToast(`账号已失效，批量导入已停止。已保存 ${successes} 个歌单。`, 'warning');
            markExpired(account.platform); return;
          }
        }
        setProgress({ completed: successes + failures, total: playlists.length, running: true });
      }
      if (playlists.length > 1) showToast(`批量导入完成：成功 ${successes} 个，失败 ${failures} 个`, failures ? 'warning' : 'success');
    } finally {
      if (active.current === version) active.current = null;
      if (valid()) {
        setPrompting(false);
        setProgress((previous) => ({ ...previous, running: false }));
      }
    }
  };

  return { statuses, progress, busy: progress.running || prompting, start, cancel,
    failed: Object.values(statuses).filter((item) => item.state === 'failed').map((item) => item.playlist) };
}
