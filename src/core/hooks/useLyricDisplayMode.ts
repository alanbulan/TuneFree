import { useEffect, useState } from 'react';
import {
  LYRIC_DISPLAY_MODE_CHANGE_EVENT,
  readLyricDisplayMode,
  type LyricDisplayMode,
} from '../utils/lyricDisplayMode';

export const useLyricDisplayMode = (): LyricDisplayMode => {
  const [mode, setMode] = useState<LyricDisplayMode>(() => readLyricDisplayMode());

  useEffect(() => {
    const syncMode = (event?: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      setMode(detail === 'karaoke' || detail === 'line' ? detail : readLyricDisplayMode());
    };

    window.addEventListener('storage', syncMode);
    window.addEventListener(LYRIC_DISPLAY_MODE_CHANGE_EVENT, syncMode);

    return () => {
      window.removeEventListener('storage', syncMode);
      window.removeEventListener(LYRIC_DISPLAY_MODE_CHANGE_EVENT, syncMode);
    };
  }, []);

  return mode;
};
