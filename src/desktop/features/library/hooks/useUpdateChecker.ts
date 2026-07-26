import { useCallback, useEffect, useState } from 'react';
import { getVersion, invokeCommand, isTauri, listenEvent } from '../../../../core/ipc';
import { useToast } from '../../../components/ToastHost';
import { describeIpcFailure } from '../ipcErrorFeedback';

const RELEASES_PAGE_URL = 'https://github.com/alanbulan/TuneFree_Mobile/releases';

interface UseUpdateCheckerResult {
  appVersion: string;
  checkingUpdate: boolean;
  downloadingUpdate: boolean;
  updateDownloadProgress: number | null;
  handleCheckUpdate: () => Promise<void>;
}

export function useUpdateChecker(): UseUpdateCheckerResult {
  const { showToast } = useToast();
  const [appVersion, setAppVersion] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    getVersion()
      .then((version) => setAppVersion(version))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listenEvent('update-progress', (payload) => {
      if (cancelled) return;
      setUpdateDownloadProgress(payload.progress);
      if (payload.progress === 100) {
        setDownloadingUpdate(false);
        setUpdateDownloadProgress(null);
      }
    }).then((unlistenFn) => {
      if (cancelled) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const openReleasePage = useCallback(async () => {
    try {
      await invokeCommand('open_external_url', { url: RELEASES_PAGE_URL });
    } catch {
      window.open(RELEASES_PAGE_URL, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!isTauri()) {
      await openReleasePage();
      return;
    }

    setDownloadingUpdate(true);
    setUpdateDownloadProgress(0);
    try {
      await invokeCommand('download_and_install_update');
    } catch (error) {
      setDownloadingUpdate(false);
      setUpdateDownloadProgress(null);
      const { message, tone } = describeIpcFailure(error, '签名更新安装失败');
      // CANCELLED 是用户自己中止的下载，不提示也不跳转发布页。
      if (!message) return;
      showToast(`${message}，已为您打开官方发布页`, tone);
      await openReleasePage();
    }
  }, [openReleasePage, showToast]);

  const checkUpdateSilently = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const update = await invokeCommand('check_for_update');
      if (!update) return;
      showToast(`发现新版本 v${update.version}，正在下载签名更新...`, 'info');
      await installUpdate();
    } catch {
      // 静默检查失败不打扰用户，手动检查会显示错误。
    }
  }, [installUpdate, showToast]);

  useEffect(() => {
    if (!isTauri()) return;
    const timer = window.setTimeout(() => {
      void checkUpdateSilently();
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [checkUpdateSilently]);

  const handleCheckUpdate = useCallback(async () => {
    if (checkingUpdate || downloadingUpdate) return;
    if (!isTauri()) {
      await openReleasePage();
      return;
    }

    setCheckingUpdate(true);
    try {
      const update = await invokeCommand('check_for_update');
      if (!update) {
        showToast(appVersion ? `当前已是最新版本 (v${appVersion})` : '当前已是最新版本', 'info');
        return;
      }

      showToast(`发现新版本 v${update.version}，正在下载签名更新...`, 'info');
      await installUpdate();
    } catch (error) {
      const { message, tone } = describeIpcFailure(error, '检查更新失败，请稍后再试');
      if (message) showToast(message, tone);
    } finally {
      setCheckingUpdate(false);
    }
  }, [appVersion, checkingUpdate, downloadingUpdate, installUpdate, openReleasePage, showToast]);

  return {
    appVersion,
    checkingUpdate,
    downloadingUpdate,
    updateDownloadProgress,
    handleCheckUpdate,
  };
}
