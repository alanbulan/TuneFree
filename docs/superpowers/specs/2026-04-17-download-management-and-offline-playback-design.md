# Download Management and Offline Playback Closure Design

## Summary

The Flutter rewrite now supports real single-track downloads into app-private storage, persists download records, and wires the player download sheet to a true download flow. However, the product still lacks two critical capabilities needed to feel complete:

1. a real download management experience for browsing, validating, and deleting downloaded tracks
2. a playback path that automatically prefers a valid local downloaded file before falling back to online resolution and streaming

This design defines the next stage: evolve the current single-track download foundation into a manageable download system while closing the offline playback loop so downloaded tracks are actually used by the player without requiring manual user switching.

The user-approved direction for this stage is:

- download management and offline-priority playback are in scope together
- playback should automatically prefer local downloaded files when a valid exact-quality match exists
- management scope should feel close to product-ready, but still avoid a full background/batch download system
- the source project app icon should also be migrated as a bounded branding parity task in this phase

## Goals

### Primary goals

1. Add a real download management experience for completed downloads.
2. Make playback automatically prefer local downloaded files when a valid exact-quality file exists.
3. Fall back to online resolution and streaming when local files are missing, invalid, or not downloaded for the requested quality.
4. Keep download records and on-disk files synchronized enough that stale or broken entries can be detected and repaired.
5. Allow deletion of downloaded files from a management UI.
6. Surface downloaded-state information in the player/library surfaces where it materially helps the user.
7. Replace the Flutter default app icons with the source project’s app icon assets so branding parity continues alongside functional parity.

### Non-goals

1. Batch downloads or playlist downloads.
2. Background download scheduling, resume, or notification-center progress.
3. Public system Downloads directory integration.
4. A full offline-only mode switch in this stage.
5. Cross-device sync of download records.
6. CarPlay/Android Auto offline behavior.
7. A fully featured file manager beyond what is needed to browse and delete downloaded tracks in-app.

## Current baseline

Relevant existing files and behavior:

- `lib/features/player/data/player_download_manager.dart`
  - performs real single-track download orchestration
  - resolves songs if needed, writes files, persists records
- `lib/features/player/data/download_file_store.dart`
  - creates app-private target paths and temp files
- `lib/features/player/data/download_record_store.dart`
  - saves and loads records keyed by song + quality, with stale-record cleanup on load
- `lib/features/player/data/player_download_service.dart`
  - exposes the manager-backed download API to the UI
- `lib/features/player/presentation/widgets/player_download_sheet.dart`
  - now triggers real downloads and surfaces success/already-exists/failure outcomes
- `lib/features/player/application/player_controller.dart`
  - still resolves playback through the existing online/runtime path only
- `lib/features/player/application/just_audio_player_engine.dart`
  - still operates through the current song-loading path without a dedicated local-file-first abstraction

What is still missing:

- list/query/delete management for all downloaded tracks
- a playback source decision layer that checks local files before online resolution
- a UI entry point for browsing downloaded tracks
- recovery behavior when records exist but files are missing
- app icon parity with the source project

## Scope

This stage contains five behavior groups.

### 1. Download management

The app must provide a management surface for downloaded tracks that can:

- list downloaded tracks
- show essential metadata (title, artist, quality, source, download time)
- detect invalid or stale records
- delete downloaded files and their records
- support basic sorting and light filtering

This does not require a full download-center with multi-job orchestration.

### 2. Offline-priority playback

When the user plays a song, the playback path should become:

- check for a valid local download for the requested song and requested quality
- if a valid local exact-quality file exists, use it
- otherwise fall back to the existing online resolution/streaming path

This should happen automatically without a manual “play local” switch.

### 3. Record/file consistency repair

The app must handle stale states safely:

- if a record exists but the file is missing, the record should be treated as invalid
- if a local file fails to load for playback, the app should treat that local path as unusable and fall back online
- deletion should aim to remove both file and record together

### 4. User-facing download/offline signals

The product should surface lightweight but useful status information, such as:

- downloaded-state indicator where appropriate
- whether playback is currently using a local file or online source (if exposed, keep it subtle)
- useful empty/error states in the download management surface

### 5. App icon parity

This stage includes a bounded branding task:

- replace the default Flutter launcher/app icons with the source project app icon assets
- update the primary platform icon assets used by the Flutter app, at minimum Android, iOS, and web, and keep the asset source reusable for other platforms where practical

This is a small parity task, not a broader visual redesign.

## Architecture

This stage should extend the current download subsystem and insert a dedicated local-playback resolution layer rather than mixing file-system logic directly into the player controller.

### 1. Download library repository

Create a higher-level repository, for example:
- `lib/features/player/data/download_library_repository.dart`

Responsibilities:
- list all stored download records
- enrich them with file existence state and lightweight display information
- support sorting and basic filters
- remove downloaded files + records together
- trigger stale-record cleanup during listing or dedicated repair flows

Non-responsibilities:
- HTTP download orchestration
- direct widget state management
- player runtime decisions

### 2. Download file store extension

Extend the current `DownloadFileStore` so it can also:
- delete a final file by path
- expose optional file metadata useful for the management list
- validate whether a file still exists for stale-record cleanup and playback checks

It remains the owner of path/file-system behavior only.

### 3. Download record store extension

Extend the current `DownloadRecordStore` so it can:
- list all download records
- remove a record directly
- query all records for a given song key
- clean malformed/stale records more proactively

It remains the owner of persistence only.

### 4. Local playback resolver

Create a dedicated resolver, for example:
- `lib/features/player/data/local_playback_resolver.dart`

Responsibilities:
- accept a target `Song` and requested `AudioQuality`
- check whether a valid local exact-quality file exists for that song
- return a playback-ready local match when found
- return a miss when local playback is not available

Important rule for this stage:
- match exact quality only
- do **not** silently downgrade to another local quality in this phase

This keeps behavior predictable: if the user requests FLAC and only MP3 is downloaded, the app falls back online instead of pretending it satisfied the FLAC request.

### 5. Player controller integration

`PlayerController` should gain a local-first playback decision path:

`play request -> LocalPlaybackResolver -> hit local ? play local : resolve remote -> engine load/play`

The controller should remain the owner of business decisions, but it should not contain raw file-system queries. It should depend on the local playback resolver as an injected boundary.

### 6. Download management UI under Library

The most coherent place for near-product-ready download management is the Library area.

Recommended shape:
- add a dedicated downloads management surface reachable from the Library manage area
- keep the player download sheet as the acquisition entry point
- keep download browsing/deletion in the Library-side management surface

This keeps “get music” and “manage downloaded music” separate while staying consistent with existing app structure.

## Data models

### Downloaded track item

Introduce a UI-facing management item, for example:

```dart
class DownloadedTrackItem {
  const DownloadedTrackItem({
    required this.songKey,
    required this.songName,
    required this.artist,
    required this.quality,
    required this.fileName,
    required this.filePath,
    required this.downloadedAt,
    required this.exists,
  });

  final String songKey;
  final String songName;
  final String artist;
  final String quality;
  final String fileName;
  final String filePath;
  final DateTime downloadedAt;
  final bool exists;
}
```

This prevents the UI from depending directly on raw persistence records.

### Local playback match

Introduce a local playback resolution result, for example:

```dart
class LocalPlaybackMatch {
  const LocalPlaybackMatch({
    required this.song,
    required this.filePath,
  });

  final Song song;
  final String filePath;
}
```

This makes local playback resolution explicit rather than overloading generic download or persistence types.

## Data flow

### A. Download management list flow

`Downloads UI -> DownloadLibraryRepository -> DownloadRecordStore + DownloadFileStore`

Detailed flow:
1. UI requests downloaded track list.
2. Repository loads all records.
3. Repository verifies each file path.
4. Missing-file records are either removed immediately or marked invalid and then removed by cleanup policy.
5. Repository returns display-ready items, already sorted/filtered for the UI.

### B. Playback request flow

`PlayerController -> LocalPlaybackResolver -> local hit ? engine load local : remote resolve path -> engine load remote`

Detailed flow:
1. User requests playback of a song.
2. Controller asks the local playback resolver whether an exact-quality local file exists.
3. If yes, controller loads the local playback source.
4. If no, controller continues through the existing remote resolution and playback path.
5. If local load fails, local playback is treated as invalid and the controller falls back online.

### C. Delete downloaded track flow

`Downloads UI -> DownloadLibraryRepository.delete(...) -> DownloadFileStore.delete -> DownloadRecordStore.remove`

Detailed flow:
1. User deletes a downloaded track.
2. Repository deletes the file if it exists.
3. Repository removes the record.
4. UI refreshes the list.
5. If deletion partially fails, repository surfaces failure and keeps state repairable.

## Behavior rules

### Local playback priority

- Prefer local only when there is a valid exact-quality local file.
- If no exact-quality local file exists, do not substitute another quality silently.
- If local playback fails at load time, treat it as invalid and fall back to online playback.

### Downloaded-state visibility

- If a song has at least one valid downloaded record, the management UI must show it.
- Player/library surfaces may show a lightweight “downloaded” indicator where useful.
- The indicator should reflect valid files, not just records.

### Stale record handling

- A record that points to a missing file is stale.
- Stale records should not block fresh download or local playback fallback.
- The system should clean them up during management list reads and local playback checks.

### Delete behavior

- Deleting a downloaded track should remove the file and the record.
- If the file is already gone, removing the record is still valid.
- User-visible failure should be generic, but diagnostics should retain enough context for debugging.

## UI behavior

### Download management surface

Recommended capabilities for this stage:
- list of downloaded tracks
- sort by download time by default
- light filters such as quality and source
- delete action for each item
- empty state when there are no downloads
- recovery from stale data without exposing broken entries as playable content

This should feel close to product-ready without becoming a full task-management center.

### Player/library surfaces

Recommended light-touch UX updates:
- downloaded badge or status where it materially helps
- playback should not force the user to understand local-vs-online routing; it should just do the right thing

### App icon update

The Flutter app should stop shipping default launcher/favicons. This stage should incorporate the source project icon into the active Flutter app assets so the migrated product branding aligns with the original app.

## Failure handling

### Local playback miss

If no matching valid local file exists:
- continue through existing online playback path
- do not show an error to the user

### Local playback load failure

If a local file exists but loading it fails:
- treat the local path as invalid
- remove or invalidate the corresponding record
- retry playback through the online path

### Management list corruption

If persisted download records are malformed or stale:
- do not crash the UI
- recover by ignoring/removing invalid records
- keep list rendering stable

### Delete failure

If deletion fails:
- keep UI stable
- show a generic delete failure message if the failure is user-visible
- preserve enough diagnostics for debugging

## Testing strategy

### 1. Repository/store tests

Add focused tests for:
- listing all downloaded records
- sorting/filtering behavior
- stale-record cleanup during listing
- delete file + remove record path
- malformed persisted data recovery

### 2. Local playback resolver tests

Add focused tests for:
- exact-quality local hit
- miss when only another quality exists
- miss when file path is stale
- cleanup behavior for stale local entries

### 3. Controller/integration tests

Add focused tests for:
- playback prefers local file when available
- playback falls back to remote when local is absent
- playback falls back to remote when local file load fails
- delete-after-download removes local-first hit on subsequent play

### 4. Widget tests

Add tests for:
- download management UI list rendering
- delete action
- empty state
- downloaded-state indicator where added
- subtle local-first playback status if surfaced

### 5. Icon verification

Add at least a lightweight verification step that the Flutter app icon assets are replaced from the source project icon set and that the primary platform shells reference the correct assets.

## Acceptance criteria

This stage is complete when all of the following are true:

1. The app provides a usable management surface for downloaded tracks.
2. Downloaded tracks can be deleted from within the app.
3. Playback automatically prefers a valid exact-quality local file before falling back online.
4. Local playback failures recover by falling back to online playback rather than dead-ending.
5. Stale records do not remain visible as valid downloaded tracks and do not block fresh playback/download behavior.
6. Focused tests cover list management, stale cleanup, delete behavior, and local-first playback behavior.
7. The Flutter app icons are replaced with the source project app icon assets for the primary app targets.

## Recommended implementation breakdown

### Task group 1: Download record/file query expansion

- extend `DownloadRecordStore`
- extend `DownloadFileStore`
- add listing, deletion, and stronger stale-record cleanup support

### Task group 2: Download management repository and state

- add `DownloadLibraryRepository`
- add management controller/state for list/sort/filter/delete
- cover repository/controller behavior with tests

### Task group 3: Local playback resolver and controller integration

- add `LocalPlaybackResolver`
- integrate local-first decision path into player controller/runtime flow
- add playback fallback tests

### Task group 4: Download management UI and visible downloaded state

- add a downloads management surface in the Library area
- wire deletion and list rendering
- add lightweight downloaded-state indicators where appropriate

### Task group 5: App icon parity and final regression

- replace default Flutter app icons with source project app icon assets
- verify platform icon references
- run focused and broad verification across playback/download surfaces

## Why this design

This design turns the current download foundation into a real user-facing subsystem while also making downloaded music genuinely useful to the player. It avoids overbuilding a background download platform, but it closes the most important product gap: downloaded tracks are manageable and automatically used for playback when possible.

It also keeps the architecture clean:
- stores own persistence and files,
- a repository owns management behavior,
- a resolver owns local-playback decisions,
- the controller remains the business orchestrator,
- and the UI stays focused on presentation and intent.

That separation is what makes the next stage safe to implement with subagents while keeping the system extensible for later batch downloads or stronger offline features.