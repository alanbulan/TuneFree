sealed class MediaSessionRemoteCommand {
  const MediaSessionRemoteCommand();
}

final class MediaSessionPlayCommand extends MediaSessionRemoteCommand {
  const MediaSessionPlayCommand();
}

final class MediaSessionPauseCommand extends MediaSessionRemoteCommand {
  const MediaSessionPauseCommand();
}

final class MediaSessionStopCommand extends MediaSessionRemoteCommand {
  const MediaSessionStopCommand();
}

final class MediaSessionSkipNextCommand extends MediaSessionRemoteCommand {
  const MediaSessionSkipNextCommand();
}

final class MediaSessionSkipPreviousCommand extends MediaSessionRemoteCommand {
  const MediaSessionSkipPreviousCommand();
}

final class MediaSessionSeekCommand extends MediaSessionRemoteCommand {
  const MediaSessionSeekCommand(this.position);

  final Duration position;
}
