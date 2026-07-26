import { GripHorizontal, Lock, Pause, Play, SkipBack, SkipForward, X, ZoomIn, ZoomOut } from 'lucide-react';

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
      <div className="desktop-lyric-drag-handle" data-tauri-drag-region title="拖动悬浮歌词">
        <GripHorizontal size={14} />
      </div>

      <Separator />

      <button type="button" title="上一首" onClick={onPrev}>
        <SkipBack size={13} fill="currentColor" />
      </button>
      <button type="button" className="desktop-lyric-toolbar-play" title={isPlaying ? '暂停' : '播放'} onClick={onPlayPause}>
        {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
      </button>
      <button type="button" title="下一首" onClick={onNext}>
        <SkipForward size={13} fill="currentColor" />
      </button>

      <Separator />

      <button type="button" title="字号放大" onClick={onSizeUp}>
        <ZoomIn size={13} />
      </button>
      <button type="button" title="字号缩小" onClick={onSizeDown}>
        <ZoomOut size={13} />
      </button>

      <Separator />

      <button type="button" title="锁定歌词（锁定后鼠标可直接穿透）" onClick={onLock}>
        <Lock size={13} />
      </button>

      <Separator />

      <button type="button" className="desktop-lyric-toolbar-close" title="关闭桌面歌词" onClick={onClose}>
        <X size={13} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function Separator() {
  return <span className="desktop-lyric-toolbar-separator" />;
}
