import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlaybackOrigin } from '../../../core/player/types';
import PlaybackOriginLabel from '../PlaybackOriginLabel';

const state = vi.hoisted(() => ({ origin: null as PlaybackOrigin | null }));
vi.mock('../../../core/contexts/PlayerContext', () => ({ usePlayerNowPlaying: () => ({ playbackOrigin: state.origin }) }));
afterEach(() => { cleanup(); state.origin = null; });

it('only identifies an account when it supplied the active URL, and shows its actual quality', () => {
  const view = render(<PlaybackOriginLabel />); expect(view.container.textContent).toBe('');
  state.origin = { kind: 'source', source: 'qq', quality: 'flac' }; view.rerender(<PlaybackOriginLabel />);
  expect(view.container.textContent).toBe('');
  state.origin = { kind: 'account', source: 'qq', quality: '128k' }; view.rerender(<PlaybackOriginLabel />);
  expect(screen.getByLabelText('播放来源：QQ 音乐账号 · 128K')).toBeTruthy();
  state.origin = { kind: 'account', source: 'kuwo', quality: 'flac' }; view.rerender(<PlaybackOriginLabel />);
  expect(screen.getByLabelText('播放来源：酷我音乐账号 · FLAC')).toBeTruthy();
  state.origin = { kind: 'account', source: 'netease', quality: 'unknown' }; view.rerender(<PlaybackOriginLabel />);
  expect(screen.getByLabelText('播放来源：网易云音乐账号 · unknown')).toBeTruthy();
  state.origin = { kind: 'account', source: 'unsupported', quality: '128k' }; view.rerender(<PlaybackOriginLabel />);
  expect(view.container.textContent).toBe('');
});
