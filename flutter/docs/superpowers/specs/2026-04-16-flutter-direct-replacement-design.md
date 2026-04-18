# Flutter Direct-Replacement Redesign Spec

## Summary

This repository will stop using the current React + Vite + Capacitor Android architecture and become a Flutter-first application repository. The migration is a direct replacement, not a side-by-side long-term coexistence plan.

The user-approved direction is:

- replace the current project root with a Flutter main project
- remove the existing Android / Capacitor shell immediately
- target Android, iOS, Web, and Desktop as the long-term platform set
- preserve the current product style where it still works
- prioritize the player experience above all other feature areas
- keep current product capability in scope rather than intentionally shrinking v1

Because the current app already contains non-trivial player, source aggregation, search, library, playlist import, lyrics, and download logic, the migration must create a Flutter architecture that supports incremental feature backfill without forcing future rewrites.

## Goals

### Primary goals

1. Establish Flutter as the only application shell and UI layer.
2. Replace the WebView-based Android strategy with a native Flutter runtime.
3. Preserve the current TuneFree product shape: Home, Search, Library, Mini Player, Full Player, queue, lyrics, playlist import, favorites, and multi-source playback flows.
4. Make the player architecture the system center so that Android-like interaction quality can be improved later without another structural rewrite.
5. Keep the codebase ready for Android, iOS, Web, and Desktop compatibility from the start.

### Non-goals

1. Pixel-perfect recreation of every current screen before the new architecture exists.
2. Equal runtime behavior across every platform on day one where platform capability differs, especially around background media and system integration.
3. Immediate deletion of all legacy business logic reference code before equivalent Flutter implementations exist.

## Approved constraints and decisions

### Migration mode

The approved strategy is direct replacement at the repository root.

This means:

- the current Android / Capacitor shell is deleted first
- the repository root becomes a Flutter project
- the old React app is no longer treated as the main runnable application
- legacy TypeScript code may temporarily remain only as migration reference until equivalent Flutter implementations replace it

### Product direction

The product direction is a hybrid of:

- keeping the current TuneFree visual identity where appropriate
- upgrading interaction behavior toward a more Android-native feel

### Priority order

1. Player foundation and player interaction quality
2. Application shell and navigation structure
3. Core content pages: Home, Search, Library
4. Lyrics, queue, and supporting player surfaces
5. Download, offline, and additional management features
6. Platform-specific polish and parity improvements

## Current system observations

The current project is a React application with a thin Capacitor Android shell.

Relevant current files include:

- `App.tsx` for top-level route composition
- `components/Layout.tsx` for bottom navigation plus player overlay handling
- `components/MiniPlayer.tsx` for compact player UI
- `components/FullPlayer.tsx` for full-screen player behavior
- `contexts/PlayerContext.tsx` for playback orchestration, queue management, progress, Media Session integration, and source fallback behavior
- `services/api.ts` for aggregate search, source routing, toplist loading, playlist import, and download helper entry points
- `pages/Home.tsx`, `pages/Search.tsx`, and `pages/Library.tsx` for the current product surfaces

The Android project currently provides only a minimal bridge activity and manifest shell. The real product logic lives in the web application.

## Target repository shape

After the replacement, the repository root should be a Flutter project with standard platform directories and a modular `lib/` tree.

Expected top-level structure:

- `lib/`
- `android/`
- `ios/`
- `web/`
- `windows/`
- `macos/`
- `linux/`
- `test/`
- `pubspec.yaml`

Expected `lib/` structure:

- `lib/app/`
- `lib/core/`
- `lib/features/`
- `lib/shared/`

### `app/`

Application composition and startup concerns:

- app entry
- router setup
- theme setup
- platform bootstrapping
- root shell and navigation container

### `core/`

Cross-cutting infrastructure:

- HTTP client and interceptors
- app configuration
- persistence primitives
- error models
- platform adapters
- media session integration boundary
- download infrastructure boundary

### `features/`

Feature modules with isolated state and UI. At minimum:

- `features/player/`
- `features/home/`
- `features/search/`
- `features/library/`

### `shared/`

Reusable design and interaction primitives:

- buttons
- list tiles
- cards
- bottom sheets
- motion tokens
- typography and spacing definitions
- common loading / empty / error states

## Technical stack

The approved implementation stack is:

- Flutter + Dart 3
- Riverpod for state management
- go_router for routing
- Dio for HTTP
- freezed + json_serializable for immutable models and serialization
- just_audio + audio_service for playback and media session integration
- shared_preferences for lightweight settings and simple persisted UI state
- repository-based persistence abstraction for favorites, playlists, queue snapshots, downloads, and other structured local data
- path_provider and platform-specific file handlers for download and filesystem workflows

## Architecture

### Layering

The Flutter app will follow this interaction path:

**UI -> Controller -> Use Case -> Repository -> Source Client / Resolver -> Player Controller / Domain State -> Platform Engine -> UI state update**

This is required to avoid reintroducing the current tight coupling between page UI, playback logic, data fetching, and system integration.

### Feature-to-feature isolation

Each feature module must expose well-bounded responsibilities:

- UI widgets should not directly orchestrate network workflows.
- Controllers should not directly encode platform media integration details.
- Repository implementations should validate and normalize all external API responses.
- Player UI components should consume a single player state source instead of stitching together multiple independent states.

## Player design

The player is the highest-priority subsystem and the center of the new app architecture.

### Player surfaces

The player is split into two coordinated layers:

1. **Mini Player**
   - globally visible above the bottom navigation when a track exists
   - shows cover art, title, quick play/pause, and next track action
   - expands into the full player

2. **Full Player**
   - presented as a dedicated full-screen player route or player sheet layer
   - contains artwork, lyrics, progress, primary transport controls, queue access, and more actions
   - designed around Android-like motion and hierarchy rather than the current iOS-like card feel

### Player state model

A single player domain state must own:

- current track
- queue
- playback state
- loading state
- playback progress and duration
- play mode
- lyrics availability and active line state
- source resolution state
- preferred audio quality

No duplicated source of truth is allowed between UI widgets and the playback engine.

### Player internals

The player module will be split into:

- `player_controller`
- `audio_engine`
- `media_session_adapter`
- `queue_manager`
- `lyrics_controller`
- `player_ui_state`

### System integration

Mobile platforms must support:

- background playback
- lock screen media controls
- notification media controls
- headset / Bluetooth transport controls
- progress synchronization with system media state

Web and Desktop must share the same domain model but may degrade gracefully where platform APIs differ.

## Content feature design

### Home

The Home feature will migrate the current toplist and featured-song flows.

Responsibilities:

- source-specific toplist loading
- list detail loading
- cached toplist results
- featured songs rendering
- quick play from toplist content

Suggested breakdown:

- `home_repository`
- `home_controller`
- `top_list_section`
- `featured_song_section`
- `home_page`

### Search

The Search feature must preserve:

- aggregate search
- single-source search
- debounced querying
- search history
- pagination / load more behavior
- source availability and error hints

Suggested breakdown:

- `search_controller`
- `search_history_store`
- `aggregate_search_usecase`
- `search_repository`
- `search_page`
- `search_result_tile`

### Library

The Library feature must preserve:

- favorites
- custom playlists
- playlist rename and delete
- playlist import
- settings and configuration management
- data export / import
- about and attribution content

Suggested breakdown:

- `library_controller`
- `favorites_repository`
- `playlists_repository`
- `settings_repository`
- `library_page`
- tab-specific widgets for favorites, playlists, management, and about

## Source and API migration design

The current `services/api.ts` acts as a thin public entry point over multiple source implementations and resolver logic. That design principle should be preserved, but its implementation should be restructured into explicit Flutter layers.

### Target breakdown

#### Source clients

Per-source clients for:

- Netease
- QQ
- Kuwo
- GD Studio-backed sources
- TuneHub-backed method execution

#### Repositories

- `search_repository`
- `toplist_repository`
- `playlist_repository`
- `resolver_repository`
- `download_repository`

#### Use cases

- `aggregate_search`
- `resolve_playable_song`
- `import_playlist`
- `load_toplists`
- `load_toplist_detail`

### Required external-boundary behavior

Because source APIs are external and unstable, repository implementations must:

- validate response shape at the boundary
- normalize partial or inconsistent payloads
- isolate source-specific failures
- surface user-safe error states upward
- avoid allowing one failed source to break aggregate search

## Error handling design

### Principles

- Validate all external data at the repository boundary.
- Keep raw transport and parse errors out of UI widgets.
- Present user-readable error states.
- Support partial success for aggregate workflows.

### Search errors

Aggregate search must continue returning partial results when one or more sources fail. UI should indicate that some sources are unavailable rather than collapsing the entire page into a full failure state.

### Playback errors

Playback failure handling must include:

- source resolution error state
- preferred quality fallback to lower quality where appropriate
- prevention of infinite retry loops
- user-visible playback failure messaging when all fallback paths fail

### Page-level UI states

Reusable page states must include:

- loading
- empty
- inline section error
- full-page error
- transient feedback via snackbar or toast

Blocking browser-style alert / confirm patterns should not be reintroduced as a primary UX mechanism.

## Multi-platform strategy

The app is designed for Android, iOS, Web, and Desktop from the start, but parity is capability-based rather than forced.

### Mobile

Mobile is the primary experience target and must receive the richest media integration and the most polished player flows.

### Web

Web must preserve the core app flow, including navigation, playback, search, library, and player UI, while gracefully handling browser limitations around background media and system control behavior.

### Desktop

Desktop should preserve the core app flow and shared architecture. System media integration can be platform-dependent, but the same domain and feature structure must still apply.

## Migration and deletion plan

### Immediate deletions

The direct-replacement plan deletes the existing Android / Capacitor shell first.

Immediate deletion scope:

- existing `android/` directory
- `capacitor.config.ts`
- Capacitor-specific package dependencies and scripts
- obsolete Android shell integration files tied only to the old architecture

### Root replacement

After shell deletion, the repository root becomes a Flutter project.

### Temporary legacy retention

Legacy React / TypeScript source may remain temporarily only as migration reference for feature parity work. It is not part of the long-term architecture and is not treated as the application of record once Flutter is established.

### Final cleanup

Once equivalent Flutter implementations exist, remaining legacy source should be deleted systematically.

## Delivery strategy

The user requested an effectively full-scope rewrite rather than a visibly reduced v1. To keep that request feasible, scope is preserved but delivery order is staged.

### Stage 0

- delete Android / Capacitor shell
- initialize Flutter project in the repository root
- establish app/core/features/shared structure
- install base dependencies and tooling

### Stage 1

- create root shell
- create bottom navigation structure
- create placeholder Home / Search / Library pages
- create mini player and full player scaffold
- create repositories and controllers as empty but wired interfaces

### Stage 2

- implement playback domain state
- connect just_audio + audio_service
- implement queue, progress, transport controls, and media session handling
- connect mini player and full player to live state

### Stage 3

- migrate Home toplists and quick play flows
- migrate Search aggregate and single-source search
- migrate Library favorites, playlists, import, and settings

### Stage 4

- migrate lyrics, queue surfaces, more-actions surfaces, and downloads
- add platform-specific improvements and parity work
- delete remaining legacy source as replacement coverage becomes complete

## Testing strategy

### Unit tests

Required unit coverage includes:

- queue transitions
- play mode transitions
- aggregate search merge behavior
- source normalization behavior
- playback quality fallback
- playlist import mapping

### Widget tests

Required widget coverage includes:

- bottom navigation shell
- mini player
- full player
- search page state transitions
- library tab transitions

### Integration tests

Required integration coverage includes:

- play from Home
- play from Search
- mini player to full player expansion
- play / pause / next / previous / seek
- playlist import
- favorites flow
- base multi-platform startup verification

## Acceptance criteria

The rewrite is considered on-track when the following are true:

1. The repository is a runnable Flutter project.
2. Android, iOS, Web, and Desktop targets are structurally supported.
3. Home, Search, and Library shells render inside the Flutter app shell.
4. Mini Player and Full Player are wired to a real player state model.
5. Playback, pause, next, previous, and seek work through the new player stack.
6. Aggregate search works and tolerates partial source failure.
7. Favorites and playlist basics work in Flutter.
8. External source failures do not crash the entire app.
9. Legacy React / Capacitor code is no longer treated as the main app runtime.

## Open implementation guidance

The migration should preserve the current product identity where it helps continuity, but it should not preserve the current architecture. Flutter is not being added as another layer; it is replacing the old stack.

The critical architectural rule is: build the player as the center of the application so that Android-like interaction quality, motion polish, and future platform-specific refinement can be improved without another large rewrite.
