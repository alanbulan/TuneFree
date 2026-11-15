import { useEffect, useRef, useState } from 'react';
import { Headphones, ShieldCheck } from 'lucide-react';
import { type AccountPlatform } from '../../../core/ipc';
import { useDesktopDialog } from '../../components/DialogHost';
import { AccountCards, LoginGuide } from './accounts/AccountCards';
import { EmptyAccounts } from './accounts/AccountPlaylists';
import AccountsLibrary from './accounts/AccountsLibrary';
import { usePlatformAccounts } from './accounts/usePlatformAccounts';

export default function AccountsView() {
  const model = usePlatformAccounts();
  const { confirmDialog } = useDesktopDialog();
  const [selected, setSelected] = useState<AccountPlatform>('netease');
  const mounted = useRef(true);
  const account = model.accounts.find((item) => item.platform === selected) ?? model.accounts[0] ?? null;
  const accountKey = account ? `${account.platform}:${account.userId}:${account.state}` : '';

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const handleLogout = async (platform: AccountPlatform) => {
    const confirmed = await confirmDialog({ title: `退出${model.accountPlatformName(platform)}`,
      message: '清除这台电脑上保存的登录会话？已经导入的本地歌单会保留。', confirmLabel: '退出登录' });
    if (!confirmed || !mounted.current) return;
    await model.logout(platform);
  };
  const busy = model.loading || model.busyPlatform !== null || model.attempt !== null;
  return <section className="accounts-page" aria-label="平台账号管理">
    {!model.native && <p className="account-browser-notice" role="status">账号登录需要运行 TuneFree 桌面应用。当前浏览器预览可以查看界面。</p>}
    {model.loading && <p className="account-loading" role="status">正在读取已保存的账号…</p>}
    {model.loading && model.credentialWaiting && <p className="account-browser-notice" role="status">系统凭据存储正在等待响应。若 macOS 钥匙串出现授权窗口，请在系统窗口中完成授权；处理后会继续读取账号。</p>}
    {model.error && <div className="account-page-error"><p className="account-error" role="alert">{model.error}</p>
      <button type="button" className="soft-button" disabled={busy} onClick={() => void model.load()}>重新读取账号</button></div>}
    <AccountCards accounts={model.accounts} native={model.native} busy={busy} busyPlatform={model.busyPlatform}
      onConnect={(platform) => { setSelected(platform); void model.start(platform); }} onRefresh={(platform) => void model.refresh(platform)}
      onLogout={(platform) => void handleLogout(platform)} />
    <div className="account-playback-overview">
      <Headphones size={20} aria-hidden="true" /><div><h2>账号优先播放</h2>
        <p>播放时优先使用歌曲所属平台的账号，音质按账号权益。</p></div><span>自动启用</span>
    </div>
    {model.attempt ? <LoginGuide attempt={model.attempt} error={model.loginError} busy={model.loginBusy}
      onCheck={() => void model.checkLogin(true)} onCancel={() => void model.cancel()} />
      : account ? <AccountsLibrary key={accountKey} accounts={model.accounts} account={account} onSelect={setSelected} markExpired={model.markExpired} /> : <EmptyAccounts />}
    <p className="account-privacy"><ShieldCheck size={14} aria-hidden="true" />已连接账号优先用于播放，音质与可播放范围按账号权益。登录会话保存在本机。</p>
  </section>;
}
