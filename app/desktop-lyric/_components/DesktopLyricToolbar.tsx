import { GripHorizontal, Lock, Pause, Play, SkipBack, SkipForward, X, ZoomIn, ZoomOut } from 'lucide-react';
import Tooltip from '../../../src/desktop/components/Tooltip';

interface DesktopLyricToolbarProps {
  isPlaying: boolean;
  onPrev: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onSizeUp: () => void;
  onSizeDown: () => void;
  onLock: () => void;
  onClose: () => void;
}

export function DesktopLyricToolbar({
  isPlaying,
  onPrev,
  onPlayPause,
  onNext,
  onSizeUp,
  onSizeDown,
  onLock,
  onClose,
}: DesktopLyricToolbarProps) {
  return (
    <div className="desktop-lyric-toolbar">
      <Tooltip label="拖动悬浮歌词">
        <div className="desktop-lyric-drag-handle" data-tauri-drag-region>
          <GripHorizontal size={14} />
        </div>
      </Tooltip>

      <Separator />

      <Tooltip label="上一首" side="top"><button type="button" aria-label="上一首" onClick={onPrev}>
        <SkipBack size={13} fill="currentColor" />
      </button></Tooltip>
      <Tooltip label={isPlaying ? '暂停' : '播放'} side="top"><button type="button" className="desktop-lyric-toolbar-play" aria-label={isPlaying ? '暂停' : '播放'} onClick={onPlayPause}>
        {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
      </button></Tooltip>
      <Tooltip label="下一首" side="top"><button type="button" aria-label="下一首" onClick={onNext}>
        <SkipForward size={13} fill="currentColor" />
      </button></Tooltip>

      <Separator />

      <Tooltip label="字号放大" side="top"><button type="button" aria-label="字号放大" onClick={onSizeUp}>
        <ZoomIn size={13} />
      </button></Tooltip>
      <Tooltip label="字号缩小" side="top"><button type="button" aria-label="字号缩小" onClick={onSizeDown}>
        <ZoomOut size={13} />
      </button></Tooltip>

      <Separator />

      <Tooltip label="锁定歌词（锁定后鼠标可直接穿透）" side="top"><button type="button" aria-label="锁定歌词（锁定后鼠标可直接穿透）" onClick={onLock}>
        <Lock size={13} />
      </button></Tooltip>

      <Separator />

      <Tooltip label="关闭桌面歌词" side="top"><button type="button" className="desktop-lyric-toolbar-close" aria-label="关闭桌面歌词" onClick={onClose}>
        <X size={13} strokeWidth={2.5} />
      </button></Tooltip>
    </div>
  );
}

function Separator() {
  return <span className="desktop-lyric-toolbar-separator" />;
}
