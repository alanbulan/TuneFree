import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDownIcon, CloseIcon, DownloadIcon } from '../../../core/components/Icons';
import { usePlayerNowPlaying, usePlayerSettings } from '../../../core/contexts/PlayerContext';
import type { AudioQuality } from '../../../core/types';
import { getDownloadMeta, qualityOptions, useSongDownload } from '../../hooks/useSongDownload';

/** 菜单高度估算（离线缓存 + 各音质，每项约 38px，外加内边距），用于判断是否向上展开。 */
const MENU_ESTIMATED_HEIGHT = (qualityOptions.length + 1) * 38 + 12;
const NAVIGATION_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

/** 全屏播放器的下载入口：一个「下载」按钮收纳离线缓存与各音质下载，避免左栏被一排按钮占满。 */
export default function FullPlayerDownloadMenu() {
  const { currentSong } = usePlayerNowPlaying();
  const { audioQuality } = usePlayerSettings();
  const { downloadQuality, downloadProgress, isCancelling, handleDownload, cancelDownload } = useSongDownload();
  const [isOpen, setIsOpen] = useState(false);
  const [upwards, setUpwards] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const isDownloading = downloadQuality !== null;

  const openMenu = () => {
    // 面板 overflow: hidden，下方空间不足时改为向上展开，免得菜单被裁掉。
    const bounds = triggerRef.current!.getBoundingClientRect();
    const panel = triggerRef.current!.closest('.full-player-panel')?.getBoundingClientRect();
    const below = (panel?.bottom ?? window.innerHeight) - bounds.bottom;
    const above = bounds.top - (panel?.top ?? 0);
    setUpwards(below < MENU_ESTIMATED_HEIGHT && above > below);
    setIsOpen(true);
  };

  const closeMenu = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  // 打开后焦点交给第一个可用项（不滚动祖先容器，免得面板被顶偏）；点击菜单外任意位置即收起。
  useEffect(() => {
    if (!isOpen) return;
    containerRef.current!.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    const handleOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current!.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && isOpen) {
      // 只收起菜单，不能冒泡到 window 上关闭整个全屏播放器。
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (!NAVIGATION_KEYS.includes(event.key)) return;
    event.preventDefault();
    if (!isOpen) {
      openMenu();
      return;
    }
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  };

  const triggerLabel = !isDownloading ? '下载' : downloadProgress !== null ? `下载 ${downloadProgress}%` : '下载中';

  return (
    <div ref={containerRef} className="full-download-menu" onKeyDown={handleKeyDown} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
    }}>
      <button
        ref={triggerRef}
        type="button"
        className={`full-action-button ${isOpen ? 'active' : ''}`}
        disabled={!currentSong && !isDownloading}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
      >
        <DownloadIcon size={16} />
        {triggerLabel}
        <ChevronDownIcon size={14} className={`full-download-arrow ${isOpen ? 'is-open' : ''}`} />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div id={menuId} role="menu" aria-label="下载音质"
            className={`full-download-options${upwards ? ' opens-upwards' : ''}`}
            initial={{ opacity: 0, y: upwards ? 6 : -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: upwards ? 6 : -6, scale: 0.98 }} transition={{ duration: 0.16 }}>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="full-download-option"
              disabled={isCancelling || (!currentSong && !isDownloading)}
              onClick={() => {
                if (isDownloading) void cancelDownload();
                else if (currentSong) void handleDownload(currentSong, audioQuality);
                closeMenu();
              }}
            >
              {isDownloading ? <CloseIcon size={15} /> : <DownloadIcon size={15} />}
              {isDownloading ? (isCancelling ? '取消中' : '取消下载') : '离线缓存'}
            </button>
            {qualityOptions.map((quality: AudioQuality) => (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="full-download-option"
                disabled={!currentSong || isDownloading}
                onClick={() => {
                  if (currentSong) void handleDownload(currentSong, quality);
                  closeMenu();
                }}
                key={quality}
              >
                <DownloadIcon size={15} />
                {downloadQuality === quality
                  ? downloadProgress !== null
                    ? `下载中 ${downloadProgress}%`
                    : '获取中'
                  : getDownloadMeta(quality).label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
