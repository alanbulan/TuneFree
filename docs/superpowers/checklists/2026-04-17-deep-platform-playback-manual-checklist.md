# Deep Platform Playback Manual Verification Checklist

## Android

- [ ] Start playback in the foreground and confirm title, artist, artwork, and progress appear in the system notification.
- [ ] Lock the device and confirm play/pause/previous/next/stop controls match the in-app player state.
- [ ] Background the app and confirm playback continues without UI drift when the app is reopened.
- [ ] Trigger a media-button play/pause action from a headset or Bluetooth device and confirm the app responds once.
- [ ] Trigger a noisy-device event (headphones unplugged) and confirm playback pauses without auto-resume.
- [ ] Trigger an interruption/focus-loss scenario and confirm playback pauses, then resumes only when it had been playing before the interruption.
- [ ] Let a song complete in `sequence`, `loop`, and `shuffle` modes and confirm the next action matches the app queue rules.

## iOS

- [ ] Start playback in the foreground and confirm Now Playing metadata appears on the lock screen/control center.
- [ ] Lock the device and confirm play/pause/previous/next controls match the in-app player state.
- [ ] Background the app and confirm playback continues, then reopen the app and verify the Flutter UI matches the real playback state.
- [ ] Trigger an interruption scenario and confirm playback pauses, then resumes only when it had been playing before the interruption.
- [ ] Use lock screen or control center seeking if available and confirm the app position updates correctly.
- [ ] Let a song complete in `sequence`, `loop`, and `shuffle` modes and confirm the next action matches the app queue rules.
