import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useToast } from '../../../components/ToastHost';

const RELEASES_PAGE_URL = 'https://github.com/alanbulan/TuneFree_Mobile/releases';

interface AvailableUpdate {
  version: string;
  notes?: string | null;
}

interface UseUpdateCheckerResult {
  appVersion: string;
  checkingUpdate: boolean;
  downloadingUpdate: boolean;
  updateDownloadProgress: number | null;
  handleCheckUpdate: () => Promise<void>;
}

const isTauriEnvironment = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function useUpdateChecker(): UseUpdateCheckerResult {
  const { showToast } = useToast();
  const [appVersion, setAppVersion] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then((version) => setAppVersion(version))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauriEnvironment()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen<{ progress: number }>('update-progress', (event) => {
      if (cancelled) return;
      setUpdateDownloadProgress(event.payload.progress);
      if (event.payload.progress === 100) {
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
      await invoke('open_external_url', { url: RELEASES_PAGE_URL });
    } catch {
      window.open(RELEASES_PAGE_URL, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!isTauriEnvironment()) {
      await openReleasePage();
      return;
    }

    setDownloadingUpdate(true);
    setUpdateDownloadProgress(0);
    try {
      await invoke('download_and_install_update');
    } catch {
      setDownloadingUpdate(false);
      setUpdateDownloadProgress(null);
      showToast('签名更新安装失败，已为您打开官方发布页', 'error');
      await openReleasePage();
    }
  }, [openReleasePage, showToast]);

  const checkUpdateSilently = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    try {
      const update = await invoke<AvailableUpdate | null>('check_for_update');
      if (!update) return;
      showToast(`发现新版本 v${update.version}，正在下载签名更新...`, 'info');
      await installUpdate();
    } catch {
      // 静默检查失败不打扰用户，手动检查会显示错误。
    }
  }, [installUpdate, showToast]);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    const timer = window.setTimeout(() => {
      void checkUpdateSilently();
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [checkUpdateSilently]);

  const handleCheckUpdate = useCallback(async () => {
    if (checkingUpdate || downloadingUpdate) return;
    if (!isTauriEnvironment()) {
      await openReleasePage();
      return;
    }

    setCheckingUpdate(true);
    try {
      const update = await invoke<AvailableUpdate | null>('check_for_update');
      if (!update) {
        showToast(appVersion ? `当前已是最新版本 (v${appVersion})` : '当前已是最新版本', 'info');
        return;
      }

      showToast(`发现新版本 v${update.version}，正在下载签名更新...`, 'info');
      await installUpdate();
    } catch {
      showToast('检查更新失败，请稍后再试', 'error');
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
