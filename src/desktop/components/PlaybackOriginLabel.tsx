import { CircleCheck } from 'lucide-react';
import { usePlayerNowPlaying } from '../../core/contexts/PlayerContext';
import { ACCOUNT_PLATFORMS } from '../../core/services/platformAccounts';

const qualityLabels: Record<string, string> = { '128k': '128K', '320k': '320K', flac: 'FLAC', flac24bit: 'Hi-Res' };

export default function PlaybackOriginLabel() {
  const { playbackOrigin } = usePlayerNowPlaying();
  if (playbackOrigin?.kind !== 'account') return null;
  const platform = ACCOUNT_PLATFORMS.find((item) => item.id === playbackOrigin.source);
  if (!platform) return null;
  const label = `${platform.name}账号 · ${qualityLabels[playbackOrigin.quality] || playbackOrigin.quality}`;
  return <span className="playback-origin" aria-label={`播放来源：${label}`} title="正在使用你的平台账号播放，音质按账号权益">
    <CircleCheck size={11} aria-hidden="true" />{label}
  </span>;
}
