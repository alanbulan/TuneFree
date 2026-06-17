'use client';

import { useEffect, useMemo, useState } from 'react';
import { parseLyrics, findActiveLyricIndex } from '../../src/core/utils/lyrics';
import { Play, Pause, SkipBack, SkipForward, Lock, ZoomIn, ZoomOut, X, GripHorizontal } from 'lucide-react';

interface LyricUpdateEvent {
  song: {
    id: string | number;
    name: string;
    artist: string;
    source: string;
    pic?: string;
    lrc?: string;
  } | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
}

export default function DesktopLyricPage() {
  const [song, setSong] = useState<LyricUpdateEvent['song']>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isTauri, setIsTauri] = useState(false);
  const [localLock, setLocalLock] = useState(false);
  const [localSize, setLocalSize] = useState(22);
  const [localFont, setLocalFont] = useState('system-ui');

  useEffect(() => {
    const checkTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
    setIsTauri(checkTauri);

    // 从 localStorage 初始化样式变量，以便独立进程页面能瞬间同步
    if (typeof window !== 'undefined') {
      const savedSize = localStorage.getItem('tunefree_lyric_size');
      if (savedSize) setLocalSize(parseInt(savedSize, 10));

      const savedFont = localStorage.getItem('tunefree_lyric_font');
      if (savedFont) setLocalFont(savedFont);

      const savedLock = localStorage.getItem('tunefree_lock_desktop_lyric');
      if (savedLock) setLocalLock(savedLock === 'true');
    }
  }, []);

  // 监听广播的播放进度与歌词
  useEffect(() => {
    if (!isTauri) return;

    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const unsub = await listen<LyricUpdateEvent>('lyric-update', (event) => {
          const { song, currentTime, isPlaying } = event.payload;
          setSong(song);
          setCurrentTime(currentTime);
          setIsPlaying(isPlaying);
        });
        unlisten = unsub;
      } catch (e) {
        console.error('Failed to listen to lyric-update:', e);
      }
    };

    setupListener();

    // 同时监听主进程推送的锁定状态变更，保持穿透属性实时对应
    const setupLockListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const lockUnsub = await listen<boolean>('lock-change', (event) => {
          setLocalLock(event.payload);
        });
        return lockUnsub;
      } catch {}
    };

    let lockUnlisten: any;
    setupLockListener().then((unsub) => {
      lockUnlisten = unsub;
    });

    return () => {
      if (unlisten) unlisten();
      if (lockUnlisten) lockUnlisten();
    };
  }, [isTauri]);

  // 定时器定时检测本地 localStorage 属性同步（主要是锁定和字号大小防抖）
  useEffect(() => {
    const handleStorageChange = () => {
      const savedSize = localStorage.getItem('tunefree_lyric_size');
      if (savedSize) setLocalSize(parseInt(savedSize, 10));

      const savedFont = localStorage.getItem('tunefree_lyric_font');
      if (savedFont) setLocalFont(savedFont);

      const savedLock = localStorage.getItem('tunefree_lock_desktop_lyric');
      if (savedLock) setLocalLock(savedLock === 'true');
    };

    window.addEventListener('storage', handleStorageChange);
    // 轮询作为 fallback，每隔 500ms 同步一次 localStorage 变量，保证两个窗口完全统一
    const interval = setInterval(handleStorageChange, 500);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // 歌词解析
  const lyricRows = useMemo(() => {
    return parseLyrics(song?.lrc || '');
  }, [song?.lrc]);

  const activeIndex = useMemo(() => {
    return findActiveLyricIndex(lyricRows, currentTime);
  }, [lyricRows, currentTime]);

  const currentLine = activeIndex >= 0 ? lyricRows[activeIndex] : null;

  const subLineText = useMemo(() => {
    if (!currentLine) return '';
    if (currentLine.translation) {
      return currentLine.translation;
    }
    const nextLine = lyricRows[activeIndex + 1];
    return nextLine ? nextLine.text : '';
  }, [currentLine, lyricRows, activeIndex]);

  // 控制指令发送
  const sendControl = async (action: string, value?: any) => {
    if (!isTauri) return;
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('player-control', { action, value });
    } catch (e) {
      console.error('Failed to emit player-control:', e);
    }
  };

  const handlePlayPause = () => sendControl('play-pause');
  const handlePrev = () => sendControl('prev');
  const handleNext = () => sendControl('next');
  const handleLock = () => {
    setLocalLock(true);
    sendControl('toggle-lock', true);
  };
  const handleSizeChange = (val: number) => {
    const nextSize = Math.max(14, Math.min(36, localSize + val));
    setLocalSize(nextSize);
    sendControl('adjust-lyric-size', val);
  };
  const handleClose = () => sendControl('close-lyric');

  return (
    <div
      className="desktop-lyric-container"
      onMouseEnter={() => !localLock && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        width: '100%',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        padding: '10px 24px',
        overflow: 'hidden',
        position: 'relative',
        userSelect: 'none',
        fontFamily: localFont,
      }}
    >
      {/* 拖动热区与控制栏 */}
      {isHovered && !localLock && (
        <div
          className="control-bar"
          style={{
            position: 'absolute',
            top: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(15, 23, 42, 0.72)',
            backdropFilter: 'blur(12px)',
            borderRadius: '20px',
            padding: '4px 10px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25), inset 0 0 0 1px rgba(255, 255, 255, 0.1)',
            zIndex: 100,
            animation: 'fadeIn 0.15s ease-out',
            color: '#f8fafc',
          }}
        >
          {/* 拖动柄 */}
          <div
            data-tauri-drag-region
            title="拖动悬浮歌词"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0 4px',
              cursor: 'move',
              opacity: 0.6,
            }}
          >
            <GripHorizontal size={14} style={{ pointerEvents: 'none' }} />
          </div>

          <span style={{ width: '1px', height: '12px', background: 'rgba(255, 255, 255, 0.15)' }} />

          <button
            type="button"
            title="上一首"
            onClick={handlePrev}
            style={btnStyle}
          >
            <SkipBack size={13} fill="currentColor" />
          </button>
          
          <button
            type="button"
            title={isPlaying ? '暂停' : '播放'}
            onClick={handlePlayPause}
            style={{ ...btnStyle, background: 'rgba(255, 255, 255, 0.1)' }}
          >
            {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
          </button>

          <button
            type="button"
            title="下一首"
            onClick={handleNext}
            style={btnStyle}
          >
            <SkipForward size={13} fill="currentColor" />
          </button>

          <span style={{ width: '1px', height: '12px', background: 'rgba(255, 255, 255, 0.15)' }} />

          <button
            type="button"
            title="字号放大"
            onClick={() => handleSizeChange(2)}
            style={btnStyle}
          >
            <ZoomIn size={13} />
          </button>

          <button
            type="button"
            title="字号缩小"
            onClick={() => handleSizeChange(-2)}
            style={btnStyle}
          >
            <ZoomOut size={13} />
          </button>

          <button
            type="button"
            title="锁定歌词（锁定后鼠标可直接穿透）"
            onClick={handleLock}
            style={btnStyle}
          >
            <Lock size={13} />
          </button>

          <span style={{ width: '1px', height: '12px', background: 'rgba(255, 255, 255, 0.15)' }} />

          <button
            type="button"
            title="关闭桌面歌词"
            onClick={handleClose}
            style={{ ...btnStyle, color: '#f87171' }}
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>
      )}

      {/* 歌词主面板：支持未锁定状态下直接按住任意文字或空白区拖拽整个窗口 */}
      <div
        data-tauri-drag-region
        className="lyric-content-box"
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          textAlign: 'center',
          marginTop: isHovered && !localLock ? '20px' : '0',
          transition: 'margin 0.2s',
          cursor: localLock ? 'default' : 'move',
        }}
      >
        {/* 第一行：主歌词 */}
        <div
          data-tauri-drag-region
          style={{
            fontSize: `${localSize}px`,
            fontWeight: 800,
            color: 'var(--accent, #fa233b)',
            lineHeight: 1.35,
            width: '100%',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            // 专业多层投影确保在任何壁纸下均可见，并且边缘过渡自然
            textShadow: '0 1.5px 0 #000, 0 -1.5px 0 #000, 1.5px 0 0 #000, -1.5px 0 0 #000, 0 0 10px rgba(0, 0, 0, 0.95), 0 2px 5px rgba(0, 0, 0, 0.8)',
            padding: '2px 4px',
          }}
        >
          {currentLine?.text || song?.name || 'TuneFree Desktop'}
        </div>

        {/* 第二行：副歌词 / 翻译 / 下一句 */}
        <div
          data-tauri-drag-region
          style={{
            fontSize: `${Math.max(12, localSize - 5)}px`,
            fontWeight: 600,
            color: '#f8fafc',
            opacity: 0.9,
            lineHeight: 1.3,
            width: '100%',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textShadow: '0 1px 0 #000, 0 -1px 0 #000, 1px 0 0 #000, -1px 0 0 #000, 0 0 8px rgba(0, 0, 0, 0.95), 0 2px 4px rgba(0, 0, 0, 0.8)',
            padding: '2px 4px',
            minHeight: `${Math.max(12, localSize - 5) * 1.3}px`,
          }}
        >
          {subLineText || (currentLine?.text ? '' : song?.artist || '听你想听')}
        </div>
      </div>

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px) translateX(-50%); }
          to { opacity: 1; transform: translateY(0) translateX(-50%); }
        }
        .control-bar {
          left: 50%;
          transform: translateX(-50%);
        }
      `}</style>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  width: '26px',
  height: '26px',
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'inherit',
  cursor: 'pointer',
  transition: 'background 0.15s, opacity 0.15s',
  outline: 'none',
};
