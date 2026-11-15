import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayerActions } from '../../../../core/contexts/PlayerContext';
import { toIpcError, type AccountPlatform, type PlatformAccount, type PlatformPlaylist, type PlatformPlaylistPreview } from '../../../../core/ipc';
import { accountPlatformName, importedPlatformSongs, platformAccounts } from '../../../../core/services/platformAccounts';
import { getSongKey, isSameSong, type Song } from '../../../../core/types';

export function usePlaylistPreview(account: PlatformAccount, playlist: PlatformPlaylist, markExpired: (platform: AccountPlatform) => void) {
  const { playQueue } = usePlayerActions();
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<PlatformPlaylistPreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Map<string, { song: Song; index: number }>>(() => new Map());
  const [working, setWorking] = useState(false);
  const [reading, setReading] = useState(false);
  const [actionError, setActionError] = useState('');
  const mounted = useRef(true);
  const version = useRef(0);
  const actionVersion = useRef(0);
  const active = useRef(false);
  const fullSongs = useRef<Song[] | null>(null);
  const songs = useMemo(() => result ? importedPlatformSongs(result) : [], [result]);
  const chosen = useMemo(() => [...selected.values()].sort((a, b) => a.index - b.index).map((item) => item.song), [selected]);
  const pageSelected = songs.length > 0 && songs.every((song) => selected.has(getSongKey(song)));

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; actionVersion.current += 1; };
  }, []);

  useEffect(() => {
    const current = ++version.current;
    const load = async () => {
      setLoading(true); setError('');
      try {
        const next = await platformAccounts.preview(account.platform, playlist.id, page);
        if (current === version.current) setResult(next);
      } catch (failure) {
        if (current !== version.current) return;
        const parsed = toIpcError(failure); setError(parsed.message);
        if (parsed.code === 'AUTH_REQUIRED') markExpired(account.platform);
      } finally { if (current === version.current) setLoading(false); }
    };
    void Promise.resolve(retry).then(load);
    return () => { version.current += 1; };
  }, [account.platform, playlist.id, page, retry, markExpired]);

  const cancelRead = () => {
    actionVersion.current += 1; active.current = false;
    setWorking(false); setReading(false);
  };

  const run = async (operation: (valid: () => boolean) => Promise<void>) => {
    if (active.current || account.state === 'expired') return;
    const current = ++actionVersion.current;
    const valid = () => mounted.current && actionVersion.current === current;
    const report = (failure: unknown) => {
      if (!valid()) return;
      const parsed = toIpcError(failure); setActionError(parsed.message);
      if (parsed.code === 'AUTH_REQUIRED') markExpired(account.platform);
    };
    active.current = true; setWorking(true); setActionError('');
    try { await operation(valid); } catch (failure) { report(failure); }
    finally {
      if (valid()) { active.current = false; setWorking(false); setReading(false); }
    }
  };

  const readAll = async (valid: () => boolean) => {
    if (fullSongs.current) return fullSongs.current;
    setReading(true);
    const payload = await platformAccounts.import(account.platform, playlist.id);
    if (!valid()) return null;
    const complete = importedPlatformSongs(payload);
    if (complete.length === 0) throw new Error('这份歌单没有可读取的歌曲。');
    fullSongs.current = complete;
    setReading(false);
    return complete;
  };

  const startPlayback = (queue: Song[], start: Song, valid: () => boolean) => {
    void Promise.resolve(playQueue(queue, start)).catch((failure: unknown) => {
      if (valid()) setActionError(toIpcError(failure).message);
    });
  };

  const playAll = (startSong?: Song) => run(async (valid) => {
    const complete = await readAll(valid);
    if (!complete || !valid()) return;
    const start = startSong ? complete.find((song) => isSameSong(song, startSong)) : complete[0];
    if (!start) throw new Error('这首歌曲已从歌单移除，请重新打开歌单。');
    startPlayback(complete, start, valid);
  });

  const playSelected = () => run(async (valid) => {
    if (chosen.length > 0) startPlayback(chosen, chosen[0], valid);
  });

  const selectAll = () => run(async (valid) => {
    const complete = await readAll(valid);
    if (complete && valid()) setSelected(new Map(complete.map((song, index) => [getSongKey(song), { song, index }])));
  });

  const toggleSongs = (items: Song[], checked: boolean) => setSelected((previous) => {
    const next = new Map(previous);
    items.forEach((song) => {
      const key = getSongKey(song);
      if (!checked) { next.delete(key); return; }
      const index = (page - 1) * result!.pageSize + songs.findIndex((item) => isSameSong(item, song));
      next.set(key, { song, index });
    });
    return next;
  });

  return { page, setPage, result, error, loading, songs, chosen, pageSelected, working, reading, actionError,
    platformName: accountPlatformName(account.platform), playAll, playSelected, selectAll, cancelRead,
    retry: () => setRetry((value) => value + 1), clearSelection: () => setSelected(new Map()),
    togglePage: (checked: boolean) => toggleSongs(songs, checked),
    toggleSong: (song: Song, checked: boolean) => toggleSongs([song], checked),
    isSelected: (song: Song) => selected.has(getSongKey(song)) };
}
