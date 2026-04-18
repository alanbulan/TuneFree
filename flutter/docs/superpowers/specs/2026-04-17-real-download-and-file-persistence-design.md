# Real Download and File Persistence Design

## Summary

The Flutter rewrite currently supports only download preparation: selecting a quality, resolving a playable song if necessary, and deriving a file name. It does not yet perform a real network download, write audio data to disk, or persist completed downloads in a way the app can reliably query later.

This design defines the next stage: upgrade the current player download flow from “prepare download” to a real, reliable, single-track download capability that writes audio files into the app’s private storage, records the result locally, and exposes a minimal but correct success/failure state to the existing player UI.

The user-approved direction for this stage is:

- prioritize reliable single-track download over a larger download-management system
- store files in an app-private directory first
- only support downloads initiated from the current player track in this stage
- keep the design small and coherent, but leave a clean path for later expansion into batch downloads or a download center

## Goals

### Primary goals

1. Allow the current player track to be truly downloaded instead of only prepared.
2. Resolve the track URL when needed before downloading, using the existing song-resolution path.
3. Save the downloaded file into an app-private directory with a deterministic, conflict-resistant file name.
4. Persist a local record of the completed download so the app can recognize already-downloaded tracks after restart.
5. Surface a minimal and correct download state to the current player download UI: downloading, success, already exists, and failure.
6. Keep the implementation small enough for subagent-driven execution without prematurely building a full download-management system.

### Non-goals

1. Batch or playlist downloads.
2. A download list page or full download center.
3. Background task recovery, resume, or multi-job scheduling.
4. Download progress percentages or notification-center progress surfaces.
5. Public/system Downloads directory integration in this stage.
6. Full offline playback selection logic.
7. Delete/export/share management for downloaded files beyond what is needed for this slice.

## Current baseline

Relevant current files:

- `lib/features/player/data/player_download_service.dart`
  - currently resolves a track if needed and returns `DownloadPreparation`
  - touches `path_provider` in real mode but does not write files
- `lib/features/player/presentation/widgets/player_download_sheet.dart`
  - currently calls `onPrepareDownload(...)`
  - shows success/failure snackbars based on preparation only
- `lib/features/player/data/song_resolution_repository.dart`
  - already supports resolving stream URLs from TuneHub-backed parsing
- `lib/core/network/tune_free_http_client.dart`
  - provides the shared `Dio` entry point already used for network operations

This means the current app already has:
- song + quality selection from the player UI
- quality-aware file naming logic
- song resolution before action
- a player download surface ready for real behavior

The missing pieces are:
- real HTTP download
- atomic file persistence
- local download record persistence
- “already downloaded” recognition

## Scope

This stage covers four behavior groups.

### 1. Single-track real download

The app downloads exactly one selected track at a time, initiated from the current player sheet.

The flow is:
- select a quality in the current player download sheet
- resolve the song if the URL is missing
- check whether a matching valid local file already exists
- if not, perform a real HTTP download
- write the file into app-private storage
- persist the completed record
- return a result to the UI

### 2. File persistence in app-private storage

The app stores downloaded audio files under an app-managed private directory, for example:
- `<app-documents>/downloads/audio/`

This stage requires:
- deterministic target paths
- sanitized and conflict-resistant file names
- temporary-file writing before final rename
- cleanup of failed partial downloads

### 3. Local download record persistence

The app stores a small record for each completed download, keyed by track identity and quality.

Each record should allow the app to answer:
- is this track already downloaded at this quality?
- where is the file?
- when was it downloaded?
- does the record still point to a file that exists?

### 4. Minimal UI state behavior

The player download sheet shows only the minimum state necessary for a correct single-track experience:
- in progress
- already exists
- success
- failure

This stage does not add a full download-management UI.

## Architecture

The design keeps responsibilities narrow and centered around a real download manager, not the UI.

### 1. Player download manager

Create a new orchestrator in the player data/application boundary, for example:
- `lib/features/player/data/player_download_manager.dart`

Responsibilities:
- accept a current song + quality request
- resolve the song if needed
- consult the record store to determine whether a valid local file already exists
- perform the real HTTP download when needed
- write the file through a file-store boundary
- persist the final record through a record-store boundary
- return a result model to the caller

Non-responsibilities:
- widget state management
- batch queueing
- multi-download scheduling

### 2. Download file store

Create a file-system boundary, for example:
- `lib/features/player/data/download_file_store.dart`

Responsibilities:
- provide the app-private audio download directory
- generate deterministic file paths
- sanitize file names
- create temporary files
- move temporary files into final location atomically when possible
- verify file existence
- remove failed temporary files

Non-responsibilities:
- HTTP networking
- song resolution
- app-level download policy

### 3. Download record store

Create a lightweight local persistence boundary, for example:
- `lib/features/player/data/download_record_store.dart`

Responsibilities:
- save completed download records
- look up a record by `(songKey, quality)`
- validate whether the stored file still exists
- remove invalid records

This stage can use a lightweight persistence strategy such as SharedPreferences-backed JSON because the scope is still single-track and metadata-light.

Non-responsibilities:
- file writing
- network downloading
- UI state

### 4. Existing player download UI

`lib/features/player/presentation/widgets/player_download_sheet.dart`

The current sheet remains the primary UI entry point, but the contract changes from:
- `onPrepareDownload(...)`

to something closer to:
- `onDownload(...)`

The widget should still only:
- trigger the action
- show minimal progress state
- show success/already-exists/failure feedback

The widget must not own file-system or network logic.

## Data models

This stage should move beyond `DownloadPreparation` and introduce a real result + record pair.

### Download result

A real result model should include at least:

```dart
class DownloadResult {
  const DownloadResult({
    required this.song,
    required this.quality,
    required this.fileName,
    required this.filePath,
    required this.alreadyExisted,
  });

  final Song song;
  final AudioQuality quality;
  final String fileName;
  final String filePath;
  final bool alreadyExisted;
}
```

### Download record

A persistent record should include at least:

```dart
class DownloadRecord {
  const DownloadRecord({
    required this.songKey,
    required this.songId,
    required this.songName,
    required this.artist,
    required this.quality,
    required this.filePath,
    required this.fileName,
    required this.downloadedAt,
  });

  final String songKey;
  final String songId;
  final String songName;
  final String artist;
  final String quality;
  final String filePath;
  final String fileName;
  final DateTime downloadedAt;
}
```

## Data flow

The download flow should be:

`PlayerDownloadSheet -> PlayerDownloadManager -> SongResolutionRepository (if needed) -> TuneFreeHttpClient/Dio -> DownloadFileStore -> DownloadRecordStore -> PlayerDownloadSheet`

Detailed flow:

1. User selects a quality in the player download sheet.
2. The sheet calls the real download entry point.
3. The manager checks whether the song has a usable URL.
4. If not, the manager resolves the song through the existing song-resolution path.
5. The manager checks the record store for an existing record with the same song key and quality.
6. If a record exists and the file still exists, return `alreadyExisted = true`.
7. Otherwise create a deterministic target path through the file store.
8. Download the file with the shared HTTP client.
9. Write to a temporary file first.
10. Promote the temporary file to the final file name.
11. Save the record.
12. Return `DownloadResult` to the UI.

## File naming and storage strategy

### Storage location

Use app-private storage first, for example:
- `<app-documents>/downloads/audio/`

Why this is the right default for this stage:
- avoids cross-platform public directory differences
- reduces permission complexity
- makes record-path consistency simpler
- keeps the first real implementation stable

### Final file name

Do not rely on only `artist - title.ext`, because it is collision-prone and can contain invalid characters.

Use a deterministic pattern such as:
- `<sanitized-artist> - <sanitized-title> [<source>-<songId>].<ext>`

Example:
- `马也_Crabbit - 海与你 [netease-123456].flac`

This preserves readability while avoiding most collisions.

### Temporary file strategy

Download first to a temporary file, for example:
- `*.download`

Then rename/move to the final file name after success.

If the download fails, remove the temporary file.

## Policy and failure handling

### Duplicate downloads

If the same `song.key + quality` has a valid existing record and the file still exists:
- do not re-download
- return a success-like result with `alreadyExisted = true`

### Stale record handling

If a record exists but the file is missing:
- remove or ignore the stale record
- treat the request as a new download

### Failure policy

#### Resolution failure
- do not download
- return failure

#### Network failure
- clean up the temporary file
- do not write a success record
- return failure

#### File write failure
- clean up the temporary file
- do not write a success record
- return failure

#### Record persistence failure
- treat this as a failed operation for this stage
- if the file has already been written, try to remove it so the app does not keep a file that it cannot track

This is important: this stage optimizes for a reliable closed loop, not partial success.

## UI behavior

The current `PlayerDownloadSheet` should be upgraded, not redesigned.

Expected behavior:

- if a quality is already being downloaded, ignore repeated taps
- while downloading, show a loading indicator for the selected quality tile
- on success:
  - show a success snackbar, e.g. `已下载到本地：<fileName>`
  - close the sheet
- on already exists:
  - show a snackbar, e.g. `该音质已下载`
  - closing the sheet is acceptable but not required
- on failure:
  - show `下载失败，请稍后重试`
  - keep the sheet open

This stage does not include:
- progress percentages
- download list UI
- background download notification UI

## Testing strategy

### 1. Download manager tests

Add focused tests covering:
- direct download when the song already has a URL
- resolve-then-download when the song does not have a URL
- already-downloaded detection avoids duplicate network work
- stale record re-downloads when file is missing
- network failure cleans up temporary files
- record-write failure rolls back file persistence

### 2. Download file store tests

Add tests covering:
- app-private download directory resolution
- file-name sanitization
- deterministic final path generation
- temporary file promotion to final file
- file existence checks

### 3. Download record store tests

Add tests covering:
- record save/load
- lookup by song key + quality
- stale record detection when file is gone
- invalid record cleanup

### 4. Widget/integration tests

Add tests for `PlayerDownloadSheet` / player wiring covering:
- successful real download flow
- already-exists flow
- failed download flow
- prevention of repeated taps during in-flight download

## Acceptance criteria

This stage is complete when all of the following are true:

1. The current player track can be truly downloaded, not just prepared.
2. Downloaded files are written into app-private storage.
3. Completed downloads are persisted as local records.
4. The app can detect and reuse already-downloaded files for the same song and quality.
5. Stale records do not block a fresh download.
6. Failed downloads do not leave partial files or success records behind.
7. The player download sheet shows correct minimal state for success, already exists, and failure.
8. Focused automated tests cover the manager/store/widget behavior that is practical to validate in Dart.

## Recommended implementation breakdown

This design is intended to turn directly into a small, subagent-friendly implementation plan.

### Task group 1: File and record foundations

- add `DownloadRecord`
- add `DownloadRecordStore`
- add `DownloadFileStore`
- test path generation, sanitization, and record persistence

### Task group 2: Real single-track download manager

- add `PlayerDownloadManager`
- connect resolution, network, file write, and record persistence
- add manager tests for success, already exists, stale record, and rollback cases

### Task group 3: Player UI wiring

- replace prepare-only path with a real download entry point in the player sheet
- surface success/already-exists/failure behavior
- add focused widget tests

### Task group 4: Verification and cleanup

- run focused and broad regression suites
- verify stale-record cleanup and repeated-tap protection
- keep the slice limited to single-track app-private downloads

## Why this design

This design matches the user-approved scope exactly: single-track reliability first, app-private storage first, and no premature expansion into a full download-management system.

It also keeps the boundaries clean:
- the manager owns orchestration,
- the file store owns disk behavior,
- the record store owns persistence,
- the UI only triggers actions and renders results.

That separation is what makes the next stage safe to implement with subagents and easy to grow later into batch downloads or a download center without throwing away the first working solution.