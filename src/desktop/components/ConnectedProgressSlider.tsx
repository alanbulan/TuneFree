import { usePlayerActions, usePlayerProgress } from '../../core/contexts/PlayerContext';
import PlayerProgressSlider from './PlayerProgressSlider';

/**
 * Self-subscribing progress slider.
 *
 * Playback time ticks at roughly 10Hz. Subscribing here rather than in the
 * transport/full-player roots keeps that update rate confined to this leaf
 * instead of re-rendering the entire surrounding tree.
 */
export default function ConnectedProgressSlider() {
  const { currentTime, duration } = usePlayerProgress();
  const { seek } = usePlayerActions();

  return <PlayerProgressSlider currentTime={currentTime} duration={duration} onSeek={seek} />;
}
