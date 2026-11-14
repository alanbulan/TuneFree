import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useLibrary } from '../../../core/contexts/LibraryContext';
import { toIpcError, type AccountPlatform, type PlatformPlaylist } from '../../../core/ipc';
import { importedPlatformSongs, platformAccounts } from '../../../core/services/platformAccounts';
import { useDesktopDialog } from '../../components/DialogHost';
import { useToast } from '../../components/ToastHost';
import { AccountCards, LoginGuide } from './accounts/AccountCards';
import AccountPlaylists from './accounts/AccountPlaylists';
import { useAccountPlaylists, usePlatformAccounts } from './accounts/usePlatformAccounts';

export default function AccountsView() {
  const model = usePlatformAccounts();
  const { playlists: localPlaylists, createPlaylist } = useLibrary();
  const { confirmDialog } = useDesktopDialog();
  const { showToast } = useToast();
  const [selected, setSelected] = useState<AccountPlatform>('netease');
  const [importTask, setImportTask] = useState<{ key: string; id: string; version: number } | null>(null);
  const mounted = useRef(true);
  const importing = useRef<number | null>(null);
  const importVersion = useRef(0);
  const account = model.accounts.find((item) => item.platform === selected) ?? model.accounts[0] ?? null;
  const accountKey = account ? `${account.platform}:${account.userId}:${account.state}` : '';
  const importingId = importTask?.key === accountKey ? importTask.id : null;
  const currentAccount = useRef(account);
  useEffect(() => { currentAccount.current = account; }, [account]);
  const cloud = useAccountPlaylists(account, model.markExpired);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; importVersion.current += 1; };
  }, []);
  useEffect(() => {
    if (accountKey) importVersion.current += 1;
    importing.current = null;
    return () => { importVersion.current += 1; };
  }, [accountKey]);

  const handleLogout = async (platform: AccountPlatform) => {
    const confirmed = await confirmDialog({ title: `退出${model.accountPlatformName(platform)}`,
      message: '清除这台电脑上保存的登录会话？已经导入的本地歌单会保留。', confirmLabel: '退出登录' });
    if (!confirmed || !mounted.current) return;
    importVersion.current += 1;
    await model.logout(platform);
  };

  const handleImport = async (playlist: PlatformPlaylist) => {
    const original = currentAccount.current;
    if (!original || importing.current !== null || original.state === 'expired') return;
    const version = ++importVersion.current;
    importing.current = version;
    try {
      if (localPlaylists.some((item) => item.name === playlist.name)) {
        const confirmed = await confirmDialog({ title: '已有同名歌单', message: `「${playlist.name}」已存在，是否再导入一份新的本地副本？`, confirmLabel: '再导入一份' });
        if (!confirmed) return;
      }
      if (!mounted.current || version !== importVersion.current) return;
      setImportTask({ key: accountKey, id: playlist.id, version });
      const payload = await platformAccounts.import(original.platform, playlist.id);
      if (!mounted.current || version !== importVersion.current || currentAccount.current?.userId !== original.userId || currentAccount.current?.platform !== original.platform) return;
      const songs = importedPlatformSongs(payload);
      if (!createPlaylist(payload.name, songs)) { showToast('本地歌单保存失败，请检查存储空间后重试', 'error'); return; }
      showToast(`已导入「${payload.name}」共 ${songs.length} 首，可在「歌单」中打开`, 'success');
    } catch (error) {
      if (!mounted.current || version !== importVersion.current) return;
      const failure = toIpcError(error);
      if (failure.code === 'AUTH_REQUIRED') model.markExpired(original.platform);
      showToast(failure.message, 'error');
    } finally {
      if (importing.current === version) importing.current = null;
      if (mounted.current) setImportTask((previous) => previous?.version === version ? null : previous);
    }
  };

  const busy = model.loading || model.busyPlatform !== null || model.attempt !== null || importingId !== null;
  return <section className="accounts-page" aria-label="平台账号管理">
    {!model.native && <p className="account-browser-notice" role="status">账号登录需要运行 TuneFree 桌面应用。当前浏览器预览可以查看界面。</p>}
    {model.loading && <p className="account-loading" role="status">正在读取已保存的账号…</p>}
    {model.error && <div className="account-page-error"><p className="account-error" role="alert">{model.error}</p>
      <button type="button" className="soft-button" disabled={busy} onClick={() => void model.load()}>重新读取账号</button></div>}
    <AccountCards accounts={model.accounts} native={model.native} busy={busy} busyPlatform={model.busyPlatform}
      onConnect={(platform) => { setSelected(platform); void model.start(platform); }} onRefresh={(platform) => void model.refresh(platform)}
      onLogout={(platform) => void handleLogout(platform)} />
    {model.attempt ? <LoginGuide attempt={model.attempt} error={model.loginError} busy={model.loginBusy}
      onCheck={() => void model.checkLogin(true)} onCancel={() => void model.cancel()} />
      : <AccountPlaylists accounts={model.accounts} account={account} playlists={cloud.playlists} loading={cloud.loading}
        error={cloud.error} importingId={importingId} onSelect={setSelected} onReload={() => void cloud.reload()} onImport={(playlist) => void handleImport(playlist)} />}
    <p className="account-privacy"><ShieldCheck size={14} aria-hidden="true" />登录会话仅保存在本机系统凭据中，歌单导入为本地副本。</p>
  </section>;
}
