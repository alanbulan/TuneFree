import { useEffect, useState } from 'react';
import { usePlayerProgress } from '../contexts/PlayerContext';

/** 仅歌词使用真实媒体时钟的 30Hz 采样；队列、推荐与其它进度 UI 保持现有刷新频率。 */
export const useLyricClock = (enabled: boolean): number => {
  const { currentTime, getPlaybackClock } = usePlayerProgress();
  const [clock, setClock] = useState(() => enabled && getPlaybackClock ? getPlaybackClock().currentTime : currentTime);
  useEffect(() => {
    if (!enabled || !getPlaybackClock) return;
    let frame = 0;
    let lastUpdate = Number.NEGATIVE_INFINITY;
    const tick = (now: number) => {
      if (now - lastUpdate >= 1000 / 30 - 1) {
        setClock(getPlaybackClock().currentTime);
        lastUpdate = now;
      }
      frame = requestAnimationFrame(tick);
    };
    tick(performance.now());
    return () => cancelAnimationFrame(frame);
  }, [enabled, getPlaybackClock]);
  return enabled && getPlaybackClock ? clock : currentTime;
};
