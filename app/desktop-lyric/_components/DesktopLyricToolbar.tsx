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
        <GripHorizontal size={14} style={{ pointerEvents: 'none' }} />
      </div>

      <Separator />

      <button type="button" title="上一首" onClick={onPrev} style={btnStyle}>
        <SkipBack size={13} fill="currentColor" />
      </button>
      <button type="button" title={isPlaying ? '暂停' : '播放'} onClick={onPlayPause} style={{ ...btnStyle, background: 'rgba(255, 255, 255, 0.1)' }}>
        {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
      </button>
      <button type="button" title="下一首" onClick={onNext} style={btnStyle}>
        <SkipForward size={13} fill="currentColor" />
      </button>

      <Separator />

      <button type="button" title="字号放大" onClick={onSizeUp} style={btnStyle}>
        <ZoomIn size={13} />
      </button>
      <button type="button" title="字号缩小" onClick={onSizeDown} style={btnStyle}>
        <ZoomOut size={13} />
      </button>

      <Separator />

      <button type="button" title="锁定歌词（锁定后鼠标可直接穿透）" onClick={onLock} style={btnStyle}>
        <Lock size={13} />
      </button>

      <Separator />

      <button type="button" title="关闭桌面歌词" onClick={onClose} style={{ ...btnStyle, color: '#f87171' }}>
        <X size={13} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function Separator() {
  return <span style={{ width: '1px', height: '12px', background: 'rgba(255, 255, 255, 0.15)' }} />;
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
