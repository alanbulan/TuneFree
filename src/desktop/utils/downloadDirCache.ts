/**
 * Display-only cache of the download directory.
 *
 * The backend (`get_download_dir`) owns the effective directory; this cache
 * exists solely to avoid a blank first frame while that command resolves and is
 * never passed back to any command.
 */
const DOWNLOAD_DIR_CACHE_KEY = 'tunefree_download_dir';

export const readCachedDownloadDir = (): string | null => {
  try {
    return localStorage.getItem(DOWNLOAD_DIR_CACHE_KEY);
  } catch {
    return null;
  }
};

export const writeCachedDownloadDir = (path: string): void => {
  try {
    localStorage.setItem(DOWNLOAD_DIR_CACHE_KEY, path);
  } catch {
    // 展示缓存写失败不影响功能，静默降级。
  }
};
