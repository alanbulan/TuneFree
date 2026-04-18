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
[ ! -d "$root/legacy" ]
[ ! -d "$root/legacy/react_app" ]
[ ! -f "$root/pubspec.yaml" ]

printf 'layout-ok\n'
