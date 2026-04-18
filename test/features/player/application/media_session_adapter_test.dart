import 'package:audio_service/audio_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/application/media_session_adapter.dart';
import 'package:tunefree/features/player/application/media_session_remote_command.dart';

final class FakeMediaSessionClient implements MediaSessionClient {
  MediaItem? mediaItem;
  PlaybackState playbackState = PlaybackState();
  int mediaItemUpdates = 0;
  int playbackStateUpdates = 0;

  @override
  Future<void> setMediaItem(MediaItem? value) async {
    mediaItem = value;
    mediaItemUpdates += 1;
  }

  @override
  Future<void> setPlaybackState(PlaybackState value) async {
    playbackState = value;
    playbackStateUpdates += 1;
  }
}

void main() {
  const song = Song(
    id: 'session-song',
    name: 'Session Song',
    artist: 'TuneFree',
    album: 'Runtime Album',
    pic: 'https://example.com/artwork.png',
    source: MusicSource.netease,
  );

  test(
    'publishes media item and playback progress through the session client',
    () async {
      final client = FakeMediaSessionClient();
      var configureCalls = 0;
      final adapter = AudioServiceMediaSessionAdapter(
        clientFactory: () async => client,
        configureAudioSession: () async {
          configureCalls += 1;
        },
      );

      await adapter.updateMetadata(song, isPlaying: true);
      await adapter.updateProgress(
        position: const Duration(seconds: 42),
        duration: const Duration(minutes: 3, seconds: 12),
      );

      expect(client.mediaItem?.id, 'netease:session-song');
      expect(client.mediaItem?.title, 'Session Song');
      expect(client.mediaItem?.album, 'Runtime Album');
      expect(client.mediaItem?.artist, 'TuneFree');
      expect(
        client.mediaItem?.duration,
        const Duration(minutes: 3, seconds: 12),
      );
      expect(
        client.mediaItem?.artUri,
        Uri.parse('https://example.com/artwork.png'),
      );
      expect(client.playbackState.processingState, AudioProcessingState.ready);
      expect(client.playbackState.playing, isTrue);
      expect(client.playbackState.controls, hasLength(4));
      expect(client.playbackState.controls.first, MediaControl.skipToPrevious);
      expect(client.playbackState.controls[1], MediaControl.pause);
      expect(client.playbackState.controls[2], MediaControl.skipToNext);
      expect(client.playbackState.controls.last, MediaControl.stop);
      expect(client.playbackState.systemActions, contains(MediaAction.seek));
      expect(
        client.playbackState.systemActions,
        contains(MediaAction.seekForward),
      );
      expect(
        client.playbackState.systemActions,
        contains(MediaAction.seekBackward),
      );
      expect(client.mediaItemUpdates, 2);
      expect(client.playbackStateUpdates, 2);
      expect(configureCalls, 1);
    },
  );

  test(
    'shared initialization futures recover from first initialization failure',
    () async {
      var configureCalls = 0;
      var clientFactoryCalls = 0;
      final client = FakeMediaSessionClient();

      AudioServiceMediaSessionAdapter.configureSharedSessionForTest(
        configureAudioSession: () async {
          configureCalls += 1;
          if (configureCalls == 1) {
            throw StateError('temporary session failure');
          }
        },
        clientFactory: (dispatchCommand) async {
          clientFactoryCalls += 1;
          if (clientFactoryCalls == 1) {
            throw StateError('temporary client failure');
          }
          return client;
        },
      );
      addTearDown(AudioServiceMediaSessionAdapter.resetSharedSessionForTest);

      final adapter = AudioServiceMediaSessionAdapter();

      await expectLater(
        adapter.updateMetadata(song, isPlaying: false),
        throwsA(isA<StateError>()),
      );
      await expectLater(
        adapter.updateMetadata(song, isPlaying: false),
        throwsA(isA<StateError>()),
      );
      await expectLater(
        adapter.updateMetadata(song, isPlaying: false),
        completes,
      );

      expect(configureCalls, greaterThan(1));
      expect(clientFactoryCalls, greaterThan(1));
      expect(client.mediaItem?.id, 'netease:session-song');
    },
  );

  test(
    'new metadata resets stale duration and position for each media item',
    () async {
      final client = FakeMediaSessionClient();
      final adapter = AudioServiceMediaSessionAdapter(
        clientFactory: () async => client,
        configureAudioSession: () async {},
      );

      const firstSong = Song(
        id: 'session-song-1',
        name: 'Session Song 1',
        artist: 'TuneFree',
        album: 'Album 1',
        source: MusicSource.netease,
      );
      const secondSong = Song(
        id: 'session-song-2',
        name: 'Session Song 2',
        artist: 'TuneFree',
        album: 'Album 2',
        source: MusicSource.netease,
      );

      await adapter.updateMetadata(firstSong, isPlaying: true);
      await adapter.updateProgress(
        position: const Duration(seconds: 42),
        duration: const Duration(minutes: 3, seconds: 12),
      );

      expect(client.mediaItem?.id, 'netease:session-song-1');
      expect(
        client.mediaItem?.duration,
        const Duration(minutes: 3, seconds: 12),
      );
      expect(client.playbackState.updatePosition, const Duration(seconds: 42));

      await adapter.updateMetadata(secondSong, isPlaying: false);

      expect(client.mediaItem?.id, 'netease:session-song-2');
      expect(client.mediaItem?.duration, isNull);
      expect(client.playbackState.updatePosition, Duration.zero);
    },
  );

  test('publishes remote commands through the adapter stream', () async {
    final adapter = AudioServiceMediaSessionAdapter(
      clientFactory: () async => FakeMediaSessionClient(),
      configureAudioSession: () async {},
    );
    final commands = <MediaSessionRemoteCommand>[];
    final subscription = adapter.remoteCommands.listen(commands.add);
    addTearDown(subscription.cancel);

    adapter.dispatchRemoteCommandForTest(const MediaSessionPlayCommand());
    adapter.dispatchRemoteCommandForTest(
      const MediaSessionSeekCommand(Duration(seconds: 9)),
    );

    await Future<void>.delayed(Duration.zero);

    expect(commands, hasLength(2));
    expect(commands.first, isA<MediaSessionPlayCommand>());
    expect(
      commands.last,
      isA<MediaSessionSeekCommand>().having(
        (value) => value.position,
        'position',
        const Duration(seconds: 9),
      ),
    );
  });

  test(
    'clear resets the published media session without creating a client early',
    () async {
      var clientCreated = false;
      final client = FakeMediaSessionClient();
      final adapter = AudioServiceMediaSessionAdapter(
        clientFactory: () async {
          clientCreated = true;
          return client;
        },
        configureAudioSession: () async {},
      );

      await adapter.clear();

      expect(clientCreated, isFalse);

      await adapter.updateMetadata(song, isPlaying: false);
      await adapter.clear();

      expect(clientCreated, isTrue);
      expect(client.mediaItem, isNull);
      expect(client.playbackState.processingState, AudioProcessingState.idle);
      expect(client.playbackState.playing, isFalse);
      expect(client.playbackState.controls, isEmpty);
    },
  );

  test(
    'clear also resets the shared default session client once initialized',
    () async {
      final client = FakeMediaSessionClient();
      final adapter = AudioServiceMediaSessionAdapter(
        clientFactory: () async => client,
        configureAudioSession: () async {},
      );

      await adapter.updateMetadata(song, isPlaying: true);
      await adapter.clear();

      expect(client.mediaItem, isNull);
      expect(client.playbackState.processingState, AudioProcessingState.idle);
      expect(client.playbackState.playing, isFalse);
    },
  );
}
