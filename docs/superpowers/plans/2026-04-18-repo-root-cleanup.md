# Repository Root Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the repository into a clean container root with `react/` and `flutter/` as the only two application subprojects, while preserving Flutter Android buildability and React startup usability.

**Architecture:** The change is a repository-shape migration, not a product feature. The plan first creates the target container layout, then moves the current Flutter root into `flutter/`, promotes `legacy/react_app` into `react/`, relocates Flutter docs into `flutter/docs/`, and finally repairs path-sensitive docs/tests so each subproject becomes self-contained from its new directory root. Validation is split by subproject so Flutter and React can each prove they still work independently.

**Tech Stack:** Git, Flutter, Dart 3, Android Gradle, React, Vite, npm

---

## Scope Check

This plan covers one coherent repository-reorganization subsystem:

- containerizing the root repository
- relocating the Flutter app to `flutter/`
- promoting the React app to `react/`
- relocating Flutter-specific docs
- repairing path-sensitive docs/tests/build commands

It intentionally does **not** cover new product features, code refactors unrelated to path moves, git-history rewriting, or splitting into multiple repositories/submodules.

## File Structure

- Modify: `.gitignore`
- Modify: `README.md`
- Move/Modify: `legacy/react_app/**` → `react/**`
- Move/Modify: current Flutter root files/directories → `flutter/**`
- Move/Modify: `docs/**` → `flutter/docs/**`
- Modify: `react/README.md`
- Modify: `flutter/README.md`
- Modify: Flutter docs under `flutter/docs/superpowers/**`
- Modify: Flutter test files with path-sensitive references under `flutter/test/**`
- Modify: Flutter golden/resource references if any under `flutter/test/**`

Responsibility split:

- Root `.gitignore` and `README.md` define the container-level repo contract.
- `react/` becomes the legacy React/PWA project root and must document/run independently.
- `flutter/` becomes the active Flutter/Android project root and must analyze/test/build independently.
- `flutter/docs/` stores Flutter-specific implementation history and planning artifacts.

---

### Task 1: Create the container root and move the two app projects into place

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`
- Move: `legacy/react_app/**` → `react/**`
- Move: `android/**` → `flutter/android/**`
- Move: `ios/**` → `flutter/ios/**`
- Move: `web/**` → `flutter/web/**`
- Move: `linux/**` → `flutter/linux/**`
- Move: `macos/**` → `flutter/macos/**`
- Move: `windows/**` → `flutter/windows/**`
- Move: `lib/**` → `flutter/lib/**`
- Move: `test/**` → `flutter/test/**`
- Move: `pubspec.yaml` → `flutter/pubspec.yaml`
- Move: `pubspec.lock` → `flutter/pubspec.lock`
- Move: `analysis_options.yaml` → `flutter/analysis_options.yaml`
- Move: `dart_test.yaml` → `flutter/dart_test.yaml`
- Move: current root `README.md` content basis → `flutter/README.md`
- Move: `docs/**` → `flutter/docs/**`

- [ ] **Step 1: Write the failing structure test script (shell check)**

Create a temporary validation script at `tools/verify_repo_layout.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"

[ -d "$root/react" ]
[ -d "$root/flutter" ]
[ -f "$root/README.md" ]
[ -f "$root/.gitignore" ]
[ -f "$root/react/package.json" ]
[ -f "$root/flutter/pubspec.yaml" ]
[ -d "$root/flutter/android" ]
[ -d "$root/flutter/lib" ]
[ -d "$root/flutter/test" ]
[ -d "$root/flutter/docs" ]
[ ! -d "$root/legacy/react_app" ]
[ ! -f "$root/pubspec.yaml" ]

printf 'layout-ok\n'
```

- [ ] **Step 2: Run the layout check before moves**

Run:

```bash
bash tools/verify_repo_layout.sh
```

Expected: FAIL because `react/` and `flutter/` do not exist yet, and the old root layout is still present.

- [ ] **Step 3: Create target directories and move the Flutter root project into `flutter/`**

Run these moves in order:

```bash
mkdir -p flutter
mv android flutter/
mv ios flutter/
mv web flutter/
mv linux flutter/
mv macos flutter/
mv windows flutter/
mv lib flutter/
mv test flutter/
mv pubspec.yaml flutter/
mv pubspec.lock flutter/
mv analysis_options.yaml flutter/
mv dart_test.yaml flutter/
```

- [ ] **Step 4: Promote the React project to `react/`**

Run:

```bash
mv legacy/react_app react
```

Then remove the now-empty legacy container if it is empty:

```bash
rmdir legacy
```

- [ ] **Step 5: Move Flutter docs into `flutter/docs/`**

Run:

```bash
mv docs flutter/
```

- [ ] **Step 6: Write the new root README as a container-level navigator**

Replace root `README.md` with:

```md
# TuneFree Monorepo

This repository now contains two parallel app projects:

- [`react/`](./react) — the original React + Vite + PWA implementation
- [`flutter/`](./flutter) — the current Flutter + Android native-first implementation

## Which project should I use?

- If you want the original web/PWA version, go to `react/`
- If you want the current Android/native client, go to `flutter/`

## Quick start

### React

```bash
cd react
npm install
npm run dev
```

### Flutter

```bash
cd flutter
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```
```

- [ ] **Step 7: Update the root `.gitignore` to remain container-safe**

Replace or merge the relevant root ignore rules into:

```gitignore
# Shared local artifacts
.worktrees/
.claude/settings.local.json

# Local Android / test artifacts
android/.kotlin/
flutter/android/.kotlin/
*.log
test/**/failures/
flutter/test/**/failures/

# Flutter / Dart
flutter/.dart_tool/
flutter/.flutter-plugins
flutter/.flutter-plugins-dependencies
flutter/.packages
flutter/.pub/
flutter/build/
flutter/pubspec_overrides.yaml

# IDE / OS
.idea/
.vscode/
.DS_Store

# React artifacts
react/node_modules/
react/dist/
```

- [ ] **Step 8: Run the layout verification again**

Run:

```bash
bash tools/verify_repo_layout.sh
```

Expected: PASS with `layout-ok`.

- [ ] **Step 9: Commit the structural move**

```bash
git add .gitignore README.md react flutter tools/verify_repo_layout.sh

git commit -m "$(cat <<'EOF'
refactor: reorganize repo into react and flutter apps
EOF
)"
```

---

### Task 2: Repair README and documentation paths after the move

**Files:**
- Modify: `react/README.md`
- Modify: `flutter/README.md`
- Modify: `flutter/docs/superpowers/specs/2026-04-18-repo-root-cleanup-design.md`
- Modify: other Flutter docs under `flutter/docs/superpowers/**` that assume the Flutter app lives at the repository root

- [ ] **Step 1: Write the failing doc-path checks**

Create `tools/verify_docs_paths.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"

! grep -R "legacy/react_app" "$root/react/README.md"
grep -q "cd react" "$root/react/README.md"
grep -q "cd flutter" "$root/flutter/README.md"
grep -R "cd flutter" "$root/flutter/docs/superpowers" >/dev/null
printf 'docs-ok\n'
```

- [ ] **Step 2: Run the doc-path check before edits**

Run:

```bash
bash tools/verify_docs_paths.sh
```

Expected: FAIL because the moved docs/README files still refer to the old layout.

- [ ] **Step 3: Update `react/README.md` to reflect the new path and role**

At minimum, change clone/start instructions from root-style commands like:

```md
git clone https://github.com/alanbulan/musicxilan.git
cd musicxilan
npm install
npm run dev
```

To container-aware usage:

```md
git clone https://github.com/alanbulan/TuneFree_Mobile.git
cd TuneFree_Mobile/react
npm install
npm run dev
```

Also add a short note near the top:

```md
> This is the original React/Vite/PWA implementation kept as the web reference version.
> The active Android/native implementation now lives in `../flutter`.
```

- [ ] **Step 4: Update `flutter/README.md` to be self-contained under `flutter/`**

Ensure all commands assume the reader enters `flutter/` first. Example section:

```md
## Local development

```bash
cd flutter
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```
```

And keep the React separation note:

```md
If you want the old web/PWA implementation, use `../react` and read `../react/README.md`.
```

- [ ] **Step 5: Update moved Flutter docs to stop assuming Flutter is the repo root**

For example, in `flutter/docs/superpowers/specs/2026-04-18-repo-root-cleanup-design.md`, update any root-based command examples from:

```bash
cd flutter
flutter analyze
flutter test
flutter build apk --debug
```

To:

```bash
cd flutter
flutter analyze
flutter test
flutter build apk --debug
```

Apply the same fix to other affected docs under `flutter/docs/superpowers/**` if they contain root-assumption commands.

- [ ] **Step 6: Re-run the doc-path verification**

Run:

```bash
bash tools/verify_docs_paths.sh
```

Expected: PASS with `docs-ok`.

- [ ] **Step 7: Commit the documentation repair slice**

```bash
git add react/README.md flutter/README.md flutter/docs tools/verify_docs_paths.sh

git commit -m "$(cat <<'EOF'
docs: update react and flutter repo navigation
EOF
)"
```

---

### Task 3: Repair Flutter path-sensitive tests and assets after subdirectory move

**Files:**
- Modify: path-sensitive files under `flutter/test/**`
- Modify: Flutter golden references or helper paths if needed
- Modify: any Flutter config/docs/scripts referencing old root-relative test paths

- [ ] **Step 1: Write a failing focused validation command list**

Use these as the initial post-move smoke targets:

```bash
cd flutter
flutter test test/features/player/data/local_playback_resolver_test.dart -r expanded
flutter test test/features/player/application/player_controller_test.dart -r expanded
flutter test test/features/library/presentation/library_page_golden_test.dart -r expanded
flutter test test/features/search/presentation/search_page_golden_test.dart -r expanded
flutter test test/features/player/presentation/player_surface_test.dart -r expanded
flutter test test/features/player/presentation/full_player_parity_test.dart -r expanded
```

Expected before fixes: one or more FAIL if any moved paths are still hard-coded.

- [ ] **Step 2: Search for old path assumptions in Flutter tests/docs**

Run:

```bash
cd flutter
grep -R "legacy/react_app\|/test/features\|goldens/\|../docs\|../README" test docs -n
```

Use the results to identify broken relative paths or root-based assumptions.

- [ ] **Step 3: Repair any broken Flutter test/resource paths minimally**

Examples of acceptable minimal fixes:

```dart
await screenMatchesGolden(tester, 'full_player_parity_more_sheet');
```

or helper paths updated to be relative to the new Flutter root instead of the old repository root.

Keep the fixes narrow: only repair moved-path fallout, do not refactor unrelated test logic.

- [ ] **Step 4: Run the focused Flutter test sweep**

Run:

```bash
cd flutter
flutter test test/features/player/data/local_playback_resolver_test.dart -r expanded
flutter test test/features/player/application/player_controller_test.dart -r expanded
flutter test test/features/library/presentation/library_page_golden_test.dart -r expanded
flutter test test/features/search/presentation/search_page_golden_test.dart -r expanded
flutter test test/features/player/presentation/player_surface_test.dart -r expanded
flutter test test/features/player/presentation/full_player_parity_test.dart -r expanded
```

Expected: PASS across all listed suites.

- [ ] **Step 5: Run Flutter analyzer and APK build from the new root**

Run:

```bash
cd flutter
flutter analyze
flutter build apk --debug
```

Expected: `No issues found!` and APK output under:

```text
flutter/build/app/outputs/flutter-apk/app-debug.apk
```

- [ ] **Step 6: Commit the Flutter path-fix slice**

```bash
git add flutter

git commit -m "$(cat <<'EOF'
fix: repair flutter paths after repo restructure
EOF
)"
```

---

### Task 4: Verify the React project still runs from `react/`

**Files:**
- Modify: `react/README.md` if command examples still diverge from reality
- Modify: React config/docs only if directory move breaks startup

- [ ] **Step 1: Run dependency install from the new React root**

Run:

```bash
cd react
npm install
```

Expected: install completes successfully.

- [ ] **Step 2: Run the React dev server smoke start**

Run:

```bash
cd react
npm run dev -- --host 127.0.0.1
```

Expected: Vite starts successfully and reports a local URL.

- [ ] **Step 3: If startup fails, apply only path-move fixes**

Examples of acceptable minimal fixes:

```json
{
  "scripts": {
    "dev": "vite"
  }
}
```
```

or README/config path updates if the move exposed wrong assumptions.

Do **not** refactor React app behavior; only fix path fallout from moving it to `react/`.

- [ ] **Step 4: Re-run the React smoke start**

Run:

```bash
cd react
npm run dev -- --host 127.0.0.1
```

Expected: Vite starts successfully again.

- [ ] **Step 5: Commit the React validation/fix slice**

```bash
git add react

git commit -m "$(cat <<'EOF'
fix: repair react paths after repo restructure
EOF
)"
```

---

### Task 5: Final repository validation and cleanup

**Files:**
- Modify: root `README.md` if final validation reveals ambiguity
- Modify: root `.gitignore` if final validation reveals missed artifacts

- [ ] **Step 1: Run the final repository shape checks**

Run:

```bash
bash tools/verify_repo_layout.sh
bash tools/verify_docs_paths.sh
```

Expected: `layout-ok` and `docs-ok`.

- [ ] **Step 2: Verify root directory now matches the accepted container model**

Run:

```bash
ls
```

Expected: the meaningful tracked entries at root are effectively limited to:

```text
.gitignore
README.md
react/
flutter/
```

(plus unavoidable git-local metadata outside tracked project files).

- [ ] **Step 3: Run final git status review**

Run:

```bash
git status
```

Expected: clean working tree.

- [ ] **Step 4: Commit the final cleanup adjustments if needed**

```bash
git add .gitignore README.md

git commit -m "$(cat <<'EOF'
chore: finalize repo container cleanup
EOF
)"
```
```

Only do this commit if Step 1-3 required additional edits.

---

## Self-Review

### Spec coverage

This plan covers all approved design requirements:

- root becomes a container repo
- `react/` and `flutter/` become the only two app subdirectories
- Flutter docs move to `flutter/docs/`
- old root role is replaced by a container README
- only old Android leftovers outside the two projects are removed
- Flutter Android build remains intact
- React remains runnable

### Placeholder scan

No `TODO`, `TBD`, or vague implementation placeholders remain. Every task includes specific files, commands, expected outcomes, and commit boundaries.

### Type consistency

Naming is consistent throughout the plan:

- `react/`
- `flutter/`
- `tools/verify_repo_layout.sh`
- `tools/verify_docs_paths.sh`
- `flutter/docs/`

No symbol or path naming drifts between tasks.
