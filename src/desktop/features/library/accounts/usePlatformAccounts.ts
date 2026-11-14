import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri, toIpcError, type AccountPlatform, type PlatformAccount, type PlatformLoginAttempt, type PlatformPlaylist } from '../../../../core/ipc';
import { accountPlatformName, platformAccounts } from '../../../../core/services/platformAccounts';

export function usePlatformAccounts() {
  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState<PlatformLoginAttempt | null>(null);
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [busyPlatform, setBusyPlatform] = useState<AccountPlatform | null>(null);
  const mounted = useRef(false);
  const attemptRef = useRef<PlatformLoginAttempt | null>(null);
  const generation = useRef(0);
  const operation = useRef(false);
  const loginCheck = useRef(false);
  const native = isTauri();

  const upsert = useCallback((account: PlatformAccount) => {
    setAccounts((previous) => [...previous.filter((item) => item.platform !== account.platform), account]);
  }, []);

  const load = useCallback(async () => {
    if (!native) { setLoading(false); return; }
    const version = ++generation.current;
    setLoading(true); setError('');
    try {
      const result = await platformAccounts.list();
      if (mounted.current && version === generation.current) setAccounts(result);
    } catch (failure) {
      if (mounted.current && version === generation.current) setError(toIpcError(failure).message);
    } finally {
      if (mounted.current && version === generation.current) setLoading(false);
    }
  }, [native]);

  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(load);
    return () => {
      mounted.current = false; generation.current += 1;
      const current = attemptRef.current;
      attemptRef.current = null;
      if (current) void platformAccounts.cancel(current.platform, current.attemptId).catch(() => {});
    };
  }, [load]);

  const start = async (platform: AccountPlatform) => {
    if (operation.current || attemptRef.current) return;
    operation.current = true;
    const version = ++generation.current;
    setBusyPlatform(platform); setError(''); setLoginError('');
    try {
      const next = await platformAccounts.start(platform);
      if (!mounted.current || version !== generation.current) {
        await platformAccounts.cancel(next.platform, next.attemptId); return;
      }
      attemptRef.current = next; setAttempt(next);
    } catch (failure) {
      if (mounted.current && version === generation.current) setError(toIpcError(failure).message);
    } finally {
      operation.current = false;
      if (mounted.current && version === generation.current) setBusyPlatform(null);
    }
  };

  const checkLogin = useCallback(async (manual = false) => {
    const current = attemptRef.current;
    if (!current || loginCheck.current || operation.current) return;
    loginCheck.current = true;
    const version = generation.current;
    setLoginBusy(true);
    try {
      const result = await platformAccounts.finish(current.platform, current.attemptId);
      if (!mounted.current || version !== generation.current || attemptRef.current?.attemptId !== current.attemptId) return;
      if (result.state === 'connected' && result.account) {
        upsert(result.account); attemptRef.current = null; setAttempt(null); setLoginError('');
      } else if (result.state === 'closed' || result.state === 'expired') {
        attemptRef.current = null; setAttempt(null);
        setError(result.state === 'closed' ? '登录窗口已关闭，请重新连接账号。' : '这次登录已超时，请重新连接账号。');
      } else if (manual) setLoginError('尚未检测到平台登录，请先在平台官网完成登录。');
    } catch (failure) {
      if (mounted.current && version === generation.current) {
        const parsed = toIpcError(failure);
        setLoginError(parsed.code === 'AUTH_REQUIRED' ? '平台尚未确认登录，请完成授权后重试。' : parsed.message);
      }
    } finally {
      loginCheck.current = false;
      if (mounted.current && version === generation.current) setLoginBusy(false);
    }
  }, [upsert]);

  useEffect(() => {
    if (!attempt || loginError) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void checkLogin();
    }, 3000);
    return () => clearInterval(timer);
  }, [attempt, loginError, checkLogin]);

  const cancel = async () => {
    const current = attemptRef.current;
    if (!current || operation.current) return;
    operation.current = true;
    const version = ++generation.current;
    setBusyPlatform(current.platform); setLoginBusy(false); setLoginError('');
    try {
      await platformAccounts.cancel(current.platform, current.attemptId);
      if (mounted.current && version === generation.current) {
        attemptRef.current = null; setAttempt(null);
      }
    } catch (failure) {
      if (mounted.current && version === generation.current) {
        const parsed = toIpcError(failure);
        if (parsed.code === 'CANCELLED') {
          // A completed native save can win the race with cancellation.
          // Read the committed account instead of hiding it in the UI.
          attemptRef.current = null; setAttempt(null);
          await load();
        } else setLoginError(parsed.message);
      }
    } finally {
      operation.current = false;
      if (mounted.current) setBusyPlatform(null);
    }
  };

  const refresh = async (platform: AccountPlatform) => {
    if (operation.current) return;
    operation.current = true;
    const version = ++generation.current;
    setBusyPlatform(platform); setError('');
    try {
      const result = await platformAccounts.refresh(platform);
      if (mounted.current && version === generation.current) upsert(result);
    } catch (failure) {
      if (mounted.current && version === generation.current) {
        const parsed = toIpcError(failure);
        if (parsed.code === 'AUTH_REQUIRED') setAccounts((previous) => previous.map((account) => account.platform === platform ? { ...account, state: 'expired' } : account));
        setError(parsed.message);
      }
    } finally {
      operation.current = false;
      if (mounted.current && version === generation.current) setBusyPlatform(null);
    }
  };

  const logout = async (platform: AccountPlatform) => {
    if (operation.current) return;
    operation.current = true;
    const version = ++generation.current;
    setBusyPlatform(platform); setError('');
    try {
      await platformAccounts.logout(platform);
      if (mounted.current && version === generation.current) setAccounts((previous) => previous.filter((item) => item.platform !== platform));
    } catch (failure) {
      if (mounted.current && version === generation.current) setError(toIpcError(failure).message);
    } finally {
      operation.current = false;
      if (mounted.current && version === generation.current) setBusyPlatform(null);
    }
  };

  const markExpired = useCallback((platform: AccountPlatform) => {
    setAccounts((previous) => previous.map((account) => account.platform === platform ? { ...account, state: 'expired' } : account));
  }, []);

  return { accounts, loading, error, native, attempt, loginError, loginBusy, busyPlatform,
    load, start, checkLogin, cancel, refresh, logout, markExpired, accountPlatformName };
}

export function useAccountPlaylists(account: PlatformAccount | null, markExpired: (platform: AccountPlatform) => void) {
  const [playlists, setPlaylists] = useState<PlatformPlaylist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const mounted = useRef(true);
  const ref = useRef(account);
  const accountKey = account ? `${account.platform}:${account.userId}:${account.state}` : '';
  useEffect(() => { ref.current = account; }, [account]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);
  const reload = useCallback(async () => {
    const current = ref.current;
    const version = ++generation.current;
    if (!current || current.state === 'expired') { setPlaylists([]); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const result = await platformAccounts.playlists(current.platform);
      if (mounted.current && version === generation.current) setPlaylists(result);
    } catch (failure) {
      if (mounted.current && version === generation.current) {
        const parsed = toIpcError(failure); setError(parsed.message);
        if (parsed.code === 'AUTH_REQUIRED') markExpired(current.platform);
      }
    } finally {
      if (mounted.current && version === generation.current) setLoading(false);
    }
  }, [markExpired]);
  useEffect(() => {
    const version = ++generation.current;
    void Promise.resolve().then(() => {
      const current = ref.current;
      const key = current ? `${current.platform}:${current.userId}:${current.state}` : '';
      if (!mounted.current || version !== generation.current || accountKey !== key) return;
      setPlaylists([]); setError(''); return reload();
    });
    return () => { generation.current += 1; };
  }, [accountKey, reload]);
  return { playlists, loading, error, reload };
}
