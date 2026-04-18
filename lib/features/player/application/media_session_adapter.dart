import 'dart:async';

import 'package:audio_service/audio_service.dart';
import 'package:audio_session/audio_session.dart';
import 'package:flutter/foundation.dart';

import '../../../core/models/song.dart';
import 'media_session_remote_command.dart';

abstract class MediaSessionAdapter {
  Stream<MediaSessionRemoteCommand> get remoteCommands;

  Future<void> updateMetadata(Song song, {required bool isPlaying});
  Future<void> updateProgress({
    required Duration position,
    required Duration duration,
  });
  Future<void> clear();
}

abstract class MediaSessionClient {
  Future<void> setMediaItem(MediaItem? value);
  Future<void> setPlaybackState(PlaybackState value);
}

typedef MediaSessionClientFactory = Future<MediaSessionClient> Function();
typedef AudioSessionConfigurator = Future<void> Function();

final class AudioServiceMediaSessionAdapter implements MediaSessionAdapter {
  AudioServiceMediaSessionAdapter({
    MediaSessionClientFactory? clientFactory,
    AudioSessionConfigurator? configureAudioSession,
  }) : _clientFactory = clientFactory,
       _configureAudioSession =
           configureAudioSession ?? _defaultConfigureAudioSession,
       _sharePlatformSession =
           clientFactory == null && configureAudioSession == null,
       _remoteCommandController =
           StreamController<MediaSessionRemoteCommand>.broadcast();

  @visibleForTesting
  static void configureSharedSessionForTest({
    AudioSessionConfigurator? configureAudioSession,
    Future<MediaSessionClient> Function(
      void Function(MediaSessionRemoteCommand command) dispatchCommand,
    )?
    clientFactory,
  }) {
    _sharedAudioSessionConfigurationForTest = configureAudioSession;
    _sharedClientFactoryForTest = clientFactory;
  }

  @visibleForTesting
  static void resetSharedSessionForTest() {
    _sharedClientFuture = null;
    _sharedAudioSessionConfigurationFuture = null;
    _sharedAudioSessionConfigurationForTest = null;
    _sharedClientFactoryForTest = null;
  }

  static Future<MediaSessionClient>? _sharedClientFuture;
  static Future<void>? _sharedAudioSessionConfigurationFuture;
  static AudioSessionConfigurator? _sharedAudioSessionConfigurationForTest;
  static Future<MediaSessionClient> Function(
    void Function(MediaSessionRemoteCommand command) dispatchCommand,
  )?
  _sharedClientFactoryForTest;
  static final StreamController<MediaSessionRemoteCommand>
  _sharedRemoteCommandController =
      StreamController<MediaSessionRemoteCommand>.broadcast();

  final MediaSessionClientFactory? _clientFactory;
  final AudioSessionConfigurator _configureAudioSession;
  final bool _sharePlatformSession;
  final StreamController<MediaSessionRemoteCommand> _remoteCommandController;

  Future<MediaSessionClient>? _clientFuture;
  Future<void>? _audioSessionConfigurationFuture;
  MediaItem? _mediaItem;
  PlaybackState _playbackState = PlaybackState();
  Duration _duration = Duration.zero;

  @override
  Stream<MediaSessionRemoteCommand> get remoteCommands =>
      (_sharePlatformSession
              ? _sharedRemoteCommandController
              : _remoteCommandController)
          .stream;

  @visibleForTesting
  void dispatchRemoteCommandForTest(MediaSessionRemoteCommand command) {
    _dispatchRemoteCommand(command);
  }

  void _dispatchRemoteCommand(MediaSessionRemoteCommand command) {
    final controller = _sharePlatformSession
        ? _sharedRemoteCommandController
        : _remoteCommandController;
    controller.add(command);
  }

  @override
  Future<void> clear() async {
    _mediaItem = null;
    _duration = Duration.zero;
    _playbackState = PlaybackState();

    final clientFuture = _sharePlatformSession
        ? _sharedClientFuture
        : _clientFuture;
    if (clientFuture == null) {
      return;
    }

    final client = await clientFuture;
    try {
      await client.setMediaItem(null);
      await client.setPlaybackState(_playbackState);
    } catch (error) {
      _logPlatformSyncFailure('clear', error);
      rethrow;
    }
  }

  @override
  Future<void> updateMetadata(Song song, {required bool isPlaying}) async {
    final client = await _ensureClient();
    final isNewMediaItem = _mediaItem == null || _mediaItem!.id != song.key;
    if (isNewMediaItem) {
      _duration = Duration.zero;
    }

    _mediaItem = _buildMediaItem(
      song,
      duration: _duration > Duration.zero ? _duration : null,
    );
    _playbackState = _buildPlaybackState(
      isPlaying: isPlaying,
      processingState: AudioProcessingState.ready,
      position: isNewMediaItem ? Duration.zero : _playbackState.updatePosition,
    );

    try {
      await client.setMediaItem(_mediaItem);
      await client.setPlaybackState(_playbackState);
    } catch (error) {
      _logPlatformSyncFailure('updateMetadata', error);
      rethrow;
    }
  }

  @override
  Future<void> updateProgress({
    required Duration position,
    required Duration duration,
  }) async {
    final client = await _ensureClient();
    _duration = duration;

    if (_mediaItem case final mediaItem?) {
      _mediaItem = mediaItem.copyWith(
        duration: duration > Duration.zero ? duration : mediaItem.duration,
      );
      try {
        await client.setMediaItem(_mediaItem);
      } catch (error) {
        _logPlatformSyncFailure('updateProgress', error);
        rethrow;
      }
    }

    _playbackState = _buildPlaybackState(
      isPlaying: _playbackState.playing,
      processingState: _mediaItem == null
          ? AudioProcessingState.idle
          : AudioProcessingState.ready,
      position: position,
    );
    try {
      await client.setPlaybackState(_playbackState);
    } catch (error) {
      _logPlatformSyncFailure('updateProgress', error);
      rethrow;
    }
  }

  Future<MediaSessionClient> _ensureClient() async {
    await _ensureAudioSessionConfigured();
    if (_sharePlatformSession) {
      try {
        return await (_sharedClientFuture ??=
            (_sharedClientFactoryForTest ?? _createDefaultClient)(
              _dispatchRemoteCommand,
            ));
      } catch (error, stackTrace) {
        _sharedClientFuture = null;
        debugPrint(
          'AudioServiceMediaSessionAdapter shared client initialization failed: $error\n$stackTrace',
        );
        rethrow;
      }
    }

    final clientFactory =
        _clientFactory ?? () => _createDefaultClient(_dispatchRemoteCommand);
    try {
      return await (_clientFuture ??= clientFactory());
    } catch (error, stackTrace) {
      _clientFuture = null;
      debugPrint(
        'AudioServiceMediaSessionAdapter client initialization failed: $error\n$stackTrace',
      );
      rethrow;
    }
  }

  Future<void> _ensureAudioSessionConfigured() async {
    if (_sharePlatformSession) {
      final configure =
          _sharedAudioSessionConfigurationForTest ?? _configureAudioSession;
      try {
        return await (_sharedAudioSessionConfigurationFuture ??= configure());
      } catch (error, stackTrace) {
        _sharedAudioSessionConfigurationFuture = null;
        debugPrint(
          'AudioServiceMediaSessionAdapter shared session configuration failed: $error\n$stackTrace',
        );
        rethrow;
      }
    }

    try {
      return await (_audioSessionConfigurationFuture ??=
          _configureAudioSession());
    } catch (error, stackTrace) {
      _audioSessionConfigurationFuture = null;
      debugPrint(
        'AudioServiceMediaSessionAdapter session configuration failed: $error\n$stackTrace',
      );
      rethrow;
    }
  }

  MediaItem _buildMediaItem(Song song, {Duration? duration}) {
    final album = song.album.trim();
    final artworkUrl = song.pic?.trim();

    return MediaItem(
      id: song.key,
      title: song.name,
      album: album.isEmpty ? null : album,
      artist: song.artist,
      duration: duration,
      artUri: artworkUrl == null || artworkUrl.isEmpty
          ? null
          : Uri.tryParse(artworkUrl),
      playable: true,
      displayTitle: song.name,
      displaySubtitle: song.artist,
      extras: <String, dynamic>{
        'songId': song.id,
        'source': song.source.wireValue,
      },
    );
  }

  void _logPlatformSyncFailure(String context, Object error) {
    debugPrint('AudioServiceMediaSessionAdapter $context failed: $error');
  }

  PlaybackState _buildPlaybackState({
    required bool isPlaying,
    required AudioProcessingState processingState,
    required Duration position,
  }) {
    final controls = <MediaControl>[
      MediaControl.skipToPrevious,
      if (isPlaying) MediaControl.pause else MediaControl.play,
      MediaControl.skipToNext,
      MediaControl.stop,
    ];

    return _playbackState.copyWith(
      processingState: processingState,
      playing: isPlaying,
      controls: controls,
      androidCompactActionIndices: const <int>[0, 1, 2],
      systemActions: const <MediaAction>{
        MediaAction.seek,
        MediaAction.seekForward,
        MediaAction.seekBackward,
      },
      updatePosition: position,
      bufferedPosition: position,
    );
  }

  static Future<void> _defaultConfigureAudioSession() async {
    final session = await AudioSession.instance;
    await session.configure(const AudioSessionConfiguration.music());
  }

  Future<MediaSessionClient> _createDefaultClient(
    void Function(MediaSessionRemoteCommand command) dispatchCommand,
  ) async {
    final handler = await AudioService.init<_MediaSessionAudioHandler>(
      builder: () => _MediaSessionAudioHandler(dispatchCommand),
      config: const AudioServiceConfig(
        androidNotificationChannelId: 'com.alanbulan.tunefree.playback',
        androidNotificationChannelName: 'TuneFree Playback',
        androidNotificationOngoing: true,
      ),
    );
    return _AudioHandlerMediaSessionClient(handler);
  }
}

final class NoopMediaSessionAdapter implements MediaSessionAdapter {
  @override
  Stream<MediaSessionRemoteCommand> get remoteCommands =>
      const Stream<MediaSessionRemoteCommand>.empty();

  @override
  Future<void> clear() async {}

  @override
  Future<void> updateMetadata(Song song, {required bool isPlaying}) async {}

  @override
  Future<void> updateProgress({
    required Duration position,
    required Duration duration,
  }) async {}
}

final class _MediaSessionAudioHandler extends BaseAudioHandler {
  _MediaSessionAudioHandler(this._dispatchCommand);

  final void Function(MediaSessionRemoteCommand command) _dispatchCommand;

  @override
  Future<void> play() async {
    _dispatchCommand(const MediaSessionPlayCommand());
  }

  @override
  Future<void> pause() async {
    _dispatchCommand(const MediaSessionPauseCommand());
  }

  @override
  Future<void> stop() async {
    _dispatchCommand(const MediaSessionStopCommand());
  }

  @override
  Future<void> skipToNext() async {
    _dispatchCommand(const MediaSessionSkipNextCommand());
  }

  @override
  Future<void> skipToPrevious() async {
    _dispatchCommand(const MediaSessionSkipPreviousCommand());
  }

  @override
  Future<void> seek(Duration position) async {
    _dispatchCommand(MediaSessionSeekCommand(position));
  }
}

final class _AudioHandlerMediaSessionClient implements MediaSessionClient {
  const _AudioHandlerMediaSessionClient(this._handler);

  final _MediaSessionAudioHandler _handler;

  @override
  Future<void> setMediaItem(MediaItem? value) async {
    _handler.mediaItem.add(value);
  }

  @override
  Future<void> setPlaybackState(PlaybackState value) async {
    _handler.playbackState.add(value);
  }
}
