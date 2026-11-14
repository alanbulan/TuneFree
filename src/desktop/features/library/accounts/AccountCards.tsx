import { ArrowRight, CircleUserRound, ExternalLink, LoaderCircle, ShieldCheck } from 'lucide-react';
import { ACCOUNT_PLATFORMS } from '../../../../core/services/platformAccounts';
import type { AccountPlatform, PlatformAccount, PlatformLoginAttempt } from '../../../../core/ipc';

interface AccountCardsProps {
  accounts: PlatformAccount[];
  busy: boolean;
  busyPlatform: AccountPlatform | null;
  native: boolean;
  onConnect: (platform: AccountPlatform) => void;
  onRefresh: (platform: AccountPlatform) => void;
  onLogout: (platform: AccountPlatform) => void;
}

export function AccountCards({ accounts, busy, busyPlatform, native, onConnect, onRefresh, onLogout }: AccountCardsProps) {
  return <div className="account-cards">
    {ACCOUNT_PLATFORMS.map(({ id, name }) => {
      const account = accounts.find((item) => item.platform === id);
      const state = account?.state;
      const label = state === 'connected' ? '已连接' : state === 'expired' ? '需要重新登录' : state === 'saved' ? '已保存登录' : '未连接';
      const waiting = busyPlatform === id;
      return <article key={id} className="content-card account-card" aria-label={`${name}账号`}>
        <div className="account-card-heading"><h2>{name}</h2><span className={`account-state is-${state || 'empty'}`}>{label}</span></div>
        <div className="account-profile">
          <span className="account-avatar">{account?.avatarUrl
            ? <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" />
            : <CircleUserRound size={38} aria-hidden="true" />}</span>
          <div><h3>{account?.nickname || '让你的歌单住进来'}</h3>
            <p>{account ? '查看创建和收藏的歌单' : '使用平台官网完成登录'}</p></div>
        </div>
        <div className="account-card-actions">
          {account && state !== 'expired' ? <>
            <button type="button" className="soft-button" disabled={busy} onClick={() => onRefresh(id)}>
              {waiting && <LoaderCircle size={14} className="account-spinner" aria-hidden="true" />} 检查连接
            </button>
            <button type="button" className="soft-button" disabled={busy} onClick={() => onConnect(id)}>重新登录</button>
          </> : <button type="button" className={accounts.some((item) => item.state !== 'expired') ? 'soft-button' : 'primary-button'} disabled={!native || busy} onClick={() => onConnect(id)}>
            {waiting ? <LoaderCircle size={14} className="account-spinner" aria-hidden="true" /> : <ArrowRight size={14} aria-hidden="true" />}
            {state === 'expired' ? '重新登录' : '连接账号'}
          </button>}
          {(account || native) && <button type="button" className="account-logout" disabled={busy} onClick={() => onLogout(id)}>
            {account ? '退出登录' : '清除登录记录'}
          </button>}
        </div>
      </article>;
    })}
  </div>;
}

interface LoginGuideProps {
  attempt: PlatformLoginAttempt;
  error: string;
  busy: boolean;
  onCheck: () => void;
  onCancel: () => void;
}

export function LoginGuide({ attempt, error, busy, onCheck, onCancel }: LoginGuideProps) {
  const name = ACCOUNT_PLATFORMS.find((item) => item.id === attempt.platform)!.name;
  return <section className="content-card account-login-guide" aria-label={`${name}登录引导`}>
    <div className="account-guide-heading"><ShieldCheck size={23} aria-hidden="true" /><h2>在 {name} 官网完成登录</h2></div>
    <p>独立登录窗口已经打开。使用平台提供的扫码或其他方式登录，然后回到这里。</p>
    <ol className="account-login-steps"><li>在平台窗口完成登录</li><li>回到 TuneFree 确认连接</li></ol>
    {error && <p className="account-error" role="alert">{error}</p>}
    <div className="account-guide-actions">
      <button type="button" className="primary-button" disabled={busy} onClick={onCheck}>
        {busy ? <LoaderCircle size={14} className="account-spinner" aria-hidden="true" /> : <ExternalLink size={14} aria-hidden="true" />}
        {busy ? '检查登录中…' : '我已完成登录'}
      </button>
      <button type="button" className="soft-button" onClick={onCancel}>取消登录</button>
    </div>
    <p className="account-guide-note">检测到有效登录后会自动连接。每次登录窗口最多保留 10 分钟。</p>
  </section>;
}
