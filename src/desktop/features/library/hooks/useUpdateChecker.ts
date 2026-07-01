import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useToast } from '../../../components/ToastHost';

/** Pure semver-style comparison: returns true when `latest` > `current`. */
export function isNewVersionAvailable(latest: string, current: string): boolean {
  if (!latest || !current) return false;
  const latestParts = latest.replace(/^v/, '').split('.').map(Number);
  const currentParts = current.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const latestVal = latestParts[i] || 0;
    const currentVal = currentParts[i] || 0;
    if (latestVal > currentVal) return true;
    if (latestVal < currentVal) return false;
  }
  return false;
}

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/alanbulan/TuneFree_Mobile/releases/latest';

interface UseUpdateCheckerResult {
  appVersion: string;
  checkingUpdate: boolean;
  downloadingUpdate: boolean;
  updateDownloadProgress: number | null;
  handleCheckUpdate: () => Promise<void>;
}

/**
 * Encapsulates all update-checking logic: version comparison, silent
 * auto-update, manual "check for updates" and the `update-progress`
 * event listener (with proper cleanup to prevent the P0 leak).
 */
export function useUpdateChecker(): UseUpdateCheckerResult {
  const { showToast } = useToast();
  const [appVersion, setAppVersion] = useState('1.1.15');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState<number | null>(null);

  // Fetch the real app version once on mount.
  useEffect(() => {
    const isTauri =
      typeof window !== 'undefined' &&
      '__TAURI_INTERNALS__' in window;
    if (!isTauri) return;
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then((ver) => setAppVersion(ver))
      .catch(() => {});
  }, []);

  // P0 fix: listen to update-progress with proper unlisten cleanup.
  useEffect(() => {
    const isTauri =
      typeof window !== 'undefined' &&
      '__TAURI_INTERNALS__' in window;
    if (!isTauri) return;

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

  const triggerAutoUpdate = useCallback(
    async (url: string) => {
      const isTauri =
        typeof window !== 'undefined' &&
        '__TAURI_INTERNALS__' in window;
      if (isTauri) {
        setDownloadingUpdate(true);
        setUpdateDownloadProgress(0);
        try {
          await invoke('download_and_install_update', { url });
        } catch {
          setDownloadingUpdate(false);
          setUpdateDownloadProgress(null);
          showToast('自动更新失败，正在调起浏览器为您下载...', 'error');
          try {
            await invoke('open_external_url', { url });
          } catch {
            showToast('无法打开下载页面，请手动前往', 'error');
          }
        }
      } else {
        window.open(url, '_blank');
      }
    },
    [showToast],
  );

  const checkUpdateSilently = useCallback(async () => {
    try {
      const response = await fetch(GITHUB_RELEASES_URL);
      if (!response.ok) return;
      const data = await response.json();
      const latestVersion: string = data.tag_name ? data.tag_name.replace(/^v/, '') : '';

      if (latestVersion && isNewVersionAvailable(latestVersion, appVersion)) {
        const asset = data.assets?.find(
          (a: { name: string; browser_download_url: string }) => a.name.endsWith('.exe'),
        );
        if (asset && asset.browser_download_url) {
          showToast(`发现新版本 v${latestVersion}，正在后台自动下载并更新...`, 'info');
          void triggerAutoUpdate(asset.browser_download_url);
        }
      }
    } catch {
      // 保持静默
    }
  }, [appVersion, showToast, triggerAutoUpdate]);

  // Silent auto-check 2 s after mount / version change.
  useEffect(() => {
    const isTauri =
      typeof window !== 'undefined' &&
      '__TAURI_INTERNALS__' in window;
    if (!isTauri) return;
    const timer = setTimeout(() => {
      void checkUpdateSilently();
    }, 2000);
    return () => clearTimeout(timer);
  }, [appVersion, checkUpdateSilently]);

  const handleCheckUpdate = useCallback(async () => {
    if (checkingUpdate || downloadingUpdate) return;
    setCheckingUpdate(true);
    try {
      const response = await fetch(GITHUB_RELEASES_URL);
      if (!response.ok) {
        throw new Error('网络请求失败');
      }
      const data = await response.json();
      const latestVersion: string = data.tag_name ? data.tag_name.replace(/^v/, '') : '';

      if (latestVersion && isNewVersionAvailable(latestVersion, appVersion)) {
        const asset = data.assets?.find(
          (a: { name: string; browser_download_url: string }) => a.name.endsWith('.exe'),
        );
        if (asset && asset.browser_download_url) {
          showToast(
            `发现新版本 v${latestVersion}，已开始后台静默下载并自动安装...`,
            'info',
          );
          void triggerAutoUpdate(asset.browser_download_url);
        } else {
          showToast(
            `发现新版本 v${latestVersion}，但未找到 Windows 安装包，已为您打开网页`,
            'info',
          );
          try {
            await invoke('open_external_url', { url: data.html_url as string });
          } catch {
            window.open(data.html_url as string, '_blank');
          }
        }
      } else {
        showToast(`当前已是最新版本 (v${appVersion})`, 'info');
      }
    } catch {
      showToast('检查更新失败，请稍后再试', 'error');
    } finally {
      setCheckingUpdate(false);
    }
  }, [appVersion, checkingUpdate, downloadingUpdate, showToast, triggerAutoUpdate]);

  return {
    appVersion,
    checkingUpdate,
    downloadingUpdate,
    updateDownloadProgress,
    handleCheckUpdate,
  };
}
