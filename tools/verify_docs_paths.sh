#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"

! grep -R "legacy/react_app" "$root/react/README.md"
grep -q "cd TuneFree_Mobile/react" "$root/react/README.md"
! grep -R "legacy/react_app" "$root/flutter/README.md"
! grep -R "cd flutter" "$root/flutter/README.md"
grep -R "cd flutter" "$root/flutter/docs/superpowers" >/dev/null
printf 'docs-ok\n'
