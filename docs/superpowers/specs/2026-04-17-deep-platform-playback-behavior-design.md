# Deep Platform Playback Behavior Design

## Summary

The current Flutter migration already has a real `just_audio` playback engine, a `PlayerController` runtime state model, song resolution, persistence, and a basic `audio_service` / `audio_session` bridge. It is good enough for in-app playback parity, but it is not yet a finished platform playback system.

This design defines the next stage: make TuneFree behave like a real dual-platform media app on Android and iOS by deepening background playback, system control handling, lifecycle coordination, and queue-completion behavior without creating a second source of truth outside the app runtime.

The user-approved direction for this stage is:

- Android and iOS are both in scope for acceptance
- the stage should aim for a near-maximal “as complete as practical now” platform playback pass
- system controls and background behavior should be treated as one cohesive stage, not split into separate projects
- implementation should remain compatible with subagent-driven execution in small reviewed tasks

## Goals

### Primary goals

1. Make background playback stable on both Android and iOS.
2. Make lock screen, control center, notification, and headset/media-button controls drive the same playback logic as the app UI.
3. Keep `PlayerController` as the single application playback source of truth.
4. Add explicit handling for audio focus changes, interruptions, noisy-device events, foreground/background transitions, and playback completion.
5. Keep media session metadata, playback state, progress, and supported actions synchronized with the real runtime state.
6. Make the result testable enough that core playback-platform behavior can be regression-tested in Dart, with a manual verification matrix for the remaining platform surfaces.

### Non-goals

1. Implement actual download/file persistence workflows.
2. Add Android Auto, CarPlay, casting, EQ, or new platform-only product features.
3. Redesign the player UI or add unrelated player capabilities.
4. Replace the current runtime architecture with an entirely new playback stack.
5. Introduce a second independent platform-owned queue or playback state model.

## Current baseline

The current Flutter codebase already contains these relevant pieces:

- `lib/features/player/application/player_controller.dart`
  - owns runtime player state, queue state, play mode, quality, and UI-facing player actions
- `lib/features/player/application/just_audio_player_engine.dart`
  - executes playback using `just_audio`
  - emits snapshots for position, duration, and player state
- `lib/features/player/application/media_session_adapter.dart`
  - publishes metadata and playback state through `audio_service`
  - configures `audio_session`
  - currently acts primarily as a publish-side bridge
- `android/app/src/main/AndroidManifest.xml`
  - already declares the `AudioService` foreground media service and media button receiver
- `ios/Runner/Info.plist`
  - already enables audio background mode

Current limitations that motivate this stage:

1. System media commands are not yet modeled as a first-class input path back into the application runtime.
2. Audio session lifecycle events are not yet coordinated through an explicit policy layer.
3. Playback completion behavior is not yet formalized as a system-visible queue policy path.
4. Media session publication exists, but the full state/command lifecycle is not yet treated as a closed loop.

## Scope

This stage includes five behavior groups.

### 1. System control handling

The app must receive and correctly handle these commands through platform media surfaces when available:

- play
- pause
- stop
- previous
- next
- seek / seekTo

These commands may originate from:

- Android notification controls
- Android lock screen / media system UI
- iOS lock screen / control center
- wired or Bluetooth media buttons routed through the platform session

### 2. Session publication and state convergence

The app must publish and keep synchronized:

- title
- artist
- album
- artwork
- duration
- position
- processing state
- playing/paused state
- supported controls/actions

This synchronization must remain correct across:

- play / pause
- manual seek
- track changes
- playback completion
- queue clearing
- stop / idle transitions
- foreground/background transitions

### 3. Background and lifecycle behavior

The app must handle:

- continuing playback in background
- returning to foreground without stale UI state
- audio focus loss / regain
- interruption begin / end
- noisy-device events such as headphone unplug

### 4. Queue and completion behavior

Playback completion and system transport commands must follow the same queue and play-mode rules as the app UI:

- `sequence`
- `loop`
- `shuffle` using the app’s current shuffle semantics

### 5. Verification

The stage must ship with:

- controller/coordinator/adapter regression tests for core behavior
- a documented Android manual verification checklist
- a documented iOS manual verification checklist

## Architecture

This stage keeps the existing runtime spine and strengthens it with explicit bridge and coordination boundaries.

### Single source of truth

`PlayerController` remains the only application-level playback authority.

That means:

- UI commands go through `PlayerController`
- system media commands go through `PlayerController`
- queue, play mode, clear behavior, and completion decisions stay in `PlayerController`

The platform layer must not invent or persist a separate queue or playback truth.

### Runtime layers

#### 1. PlayerController

`lib/features/player/application/player_controller.dart`

Responsibilities:

- own current song, queue, play mode, position, duration, and playback booleans
- expose unified commands such as play, pause, seek, next, previous, stop, clear queue
- decide what happens on playback completion
- decide how system commands map into current business state
- remain the bridge point between platform commands and runtime engine execution

Non-responsibilities:

- listening directly to platform interruption/focus streams
- encoding raw `audio_service` or `audio_session` plumbing

#### 2. Player engine

`lib/features/player/application/just_audio_player_engine.dart`

Responsibilities:

- execute playback commands against `just_audio`
- emit factual runtime signals such as position, duration, playing state, and processing/completion state
- expose completion-capable state transitions needed by the controller

Non-responsibilities:

- deciding next track policy
- deciding interruption recovery behavior
- holding the authoritative queue policy

#### 3. Media session adapter

`lib/features/player/application/media_session_adapter.dart`

Responsibilities:

- publish metadata, playback state, and supported controls to the platform session
- receive platform transport commands and hand them back to the app runtime through explicit callbacks or command events
- keep publish-side failures isolated from playback success

Non-responsibilities:

- mutating business state directly
- deciding queue behavior or interruption policy

#### 4. Playback lifecycle coordinator

A new coordinator should be introduced in the player application layer, for example:

- `lib/features/player/application/playback_lifecycle_coordinator.dart`

Responsibilities:

- subscribe to `audio_session` lifecycle signals such as interruptions, focus changes, and noisy-device events
- translate those signals into `PlayerController` actions according to explicit policy
- trigger state re-synchronization when needed after lifecycle transitions

Non-responsibilities:

- storing a second persistent playback state
- bypassing controller logic with direct queue policy decisions

## Event and state flow

### UI control flow

`UI -> PlayerController -> PlayerEngine -> PlayerController state update -> MediaSessionAdapter publish -> UI refresh`

UI actions continue to use controller APIs. The controller remains the place where engine updates and app-visible state converge.

### System control flow

`System media control -> MediaSessionAdapter -> PlayerController -> PlayerEngine -> PlayerController state update -> MediaSessionAdapter publish`

System controls must never directly drive queue or play-mode changes inside the adapter or engine. They become controller commands so that app and system remain aligned.

### Lifecycle flow

`Audio session event -> PlaybackLifecycleCoordinator -> PlayerController -> PlayerEngine -> PlayerController state update -> MediaSessionAdapter publish if needed`

Examples:

- interruption begins -> coordinator pauses if policy requires it
- interruption ends -> coordinator decides whether auto-resume is allowed
- noisy-device event -> coordinator pauses and leaves playback stopped until user resumes

### Completion flow

`Engine completion signal -> PlayerController -> queue/play-mode decision -> load/seek/play next state -> MediaSessionAdapter publish`

Playback completion is an application policy event, not an engine-owned queue event.

## Behavior rules

### System transport commands

#### Play

- If a current song is already loaded, resume playback.
- If the queue is non-empty and current song is null, recover the appropriate current item and start playback.
- If no song exists, ignore and republish the real idle state.

#### Pause

- Pause playback if currently active.
- If already paused or idle, treat as idempotent and republish the current state if necessary.

#### Stop

- Stop playback and converge session state to idle/non-playing.
- The app should not leave a stale active-looking platform session after stop.

#### Next / Previous

- Route through the same queue logic the app UI uses.
- If queue rules produce no valid move, ignore and republish current state.

#### Seek

- Clamp or reject invalid seek targets at the runtime boundary.
- After a valid seek, progress publication must converge on the new value.

### Playback completion

#### Sequence mode

- Advance according to the app’s existing queue policy.
- If the current implementation wraps at queue end, system-triggered and completion-triggered advances must do the same.

#### Loop mode

- Seek current track to zero and continue playback.

#### Shuffle mode

- Reuse the app’s current shuffle semantics.
- This stage does not redefine shuffle behavior.
- System next/previous/completion must stay consistent with the app’s chosen shuffle behavior.

### Interruption and focus policy

#### Interruption begin

- If playback was active when the interruption began, pause.
- Record that the pause was system-caused so recovery can be policy-based.
- If the player was already paused, do not mark it resumable.

#### Interruption end

- Auto-resume only if playback had been active before the interruption and the interruption type allows resume.
- Never auto-resume something the user had already paused.

#### Becoming noisy

- Pause playback immediately.
- Do not auto-resume.

#### Ducking

- Preferred behavior: duck volume temporarily and restore it when the ducking event ends.
- If stable duck support cannot be made reliable in the chosen abstraction layer, degrade to pause/resume behavior with explicit documentation.

### Foreground/background transitions

- Background playback must continue if playback is active and platform policy allows it.
- When returning to foreground, UI state must refresh from the real runtime state rather than relying on stale pre-background assumptions.
- Session publication must remain correct across app visibility changes.

## Error handling

### Playback success has priority over publish success

If playback commands succeed in the engine, a failure to publish media session state must not roll back playback.

Examples:

- `play()` succeeds but metadata publication fails -> playback continues, failure is logged, state is retried on later updates
- `seek()` succeeds but progress publish fails -> playback stays at the new position, later publishes must converge

### Invalid or non-actionable system commands

If a system command cannot be executed because the runtime state does not allow it:

- ignore the command
- republish the current real session state if needed
- do not fabricate state transitions

### Observability

Platform-bridge failures should not stay totally silent. This stage should add lightweight diagnostics for:

- media session publication failures
- remote command registration or callback failures
- lifecycle/coordinator event handling failures

These diagnostics are for development and debugging, not user-facing error banners.

## Testing strategy

### 1. Controller-level behavior tests

Add or extend tests covering:

- system play / pause / stop / next / previous / seek commands routed through controller APIs
- playback completion decisions for `sequence`, `loop`, and current `shuffle`
- invalid command handling when queue/current song state does not allow action
- interruption recovery policy based on whether playback was active beforehand
- noisy-device pause behavior

### 2. Adapter and coordinator tests

Add focused tests covering:

- media session command bridge from platform callbacks to runtime command events
- metadata and playback-state publication correctness
- state convergence after clear/stop/idle paths
- lifecycle coordinator handling for interruption begin/end, noisy events, and focus changes
- non-fatal behavior when publication fails

### 3. Manual verification matrix

The spec should produce a handoff checklist that includes at least these scenarios.

#### Android manual checks

- play in foreground, background app, and keep playback active
- use notification controls for play/pause/next/previous/stop
- lock device and verify media controls remain correct
- verify media-button/headset play-pause behavior
- verify focus loss/interruption pause behavior and eligible resume behavior
- verify playback completion follows play mode rules

#### iOS manual checks

- play in foreground, background app, and keep playback active
- use lock screen/control center controls for play/pause/next/previous and seek if available
- verify interruption pause behavior and eligible resume behavior
- return app to foreground and confirm UI state is accurate
- verify track changes refresh Now Playing metadata correctly

## Acceptance criteria

This stage is complete when all of the following are true:

1. Android and iOS both support stable background playback for the current Flutter player runtime.
2. System play/pause/next/previous/stop/seek actions feed into the same app runtime logic as UI actions.
3. Playback completion follows the controller’s queue and play-mode policy rather than ad hoc engine or platform behavior.
4. Audio interruptions, focus changes, and noisy-device events follow explicit tested policy.
5. Media session state converges correctly after play, pause, seek, track change, clear, and stop.
6. Automated regression coverage exists for the controller/coordinator/adapter behavior that is practical to test in Dart.
7. A dual-platform manual verification checklist exists for the remaining platform-only scenarios.

## Recommended implementation breakdown

This design is intended to turn directly into an implementation plan with small reviewed tasks.

### Task group 1: Media command bridge

- extend `media_session_adapter.dart` to support remote/system transport command callbacks
- create a runtime-safe command surface for play/pause/stop/next/previous/seek
- add adapter tests for publish + receive paths

### Task group 2: Lifecycle coordinator

- add `playback_lifecycle_coordinator.dart`
- subscribe to interruption/focus/noisy events
- encode pause/resume/duck policy
- add coordinator tests

### Task group 3: Controller command unification and completion policy

- make sure system commands and UI commands land on the same controller entry points
- formalize playback completion handling through queue/play-mode logic
- add controller tests for completion and invalid command cases

### Task group 4: Session synchronization hardening

- ensure metadata, playback state, progress, and supported controls stay synchronized across track changes, stop, clear, and idle transitions
- add diagnostics for non-fatal publish failures

### Task group 5: Platform verification and polish

- patch any remaining Android/iOS configuration gaps uncovered during verification
- document and execute the manual verification matrix
- keep changes scoped to playback-platform behavior only

## Why this design

This approach improves platform playback behavior without undoing the runtime architecture already built in the Flutter migration. It keeps business decisions in the controller, playback execution in the engine, platform translation in the media session adapter, and lifecycle policy in a dedicated coordinator.

That separation is what makes the next stage suitable for subagent-driven implementation: each task can change a focused boundary, be reviewed independently, and still contribute to one coherent end-to-end playback system.