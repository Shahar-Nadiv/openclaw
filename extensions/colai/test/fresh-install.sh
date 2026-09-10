#!/usr/bin/env bash
# Install colai the way somebody else would, on a machine that has never seen it.
#
# `openclaw plugins install -l <dir>` on this desktop proves the wiring and close to
# nothing else: there is a configured Gateway here, a Rust toolchain, every header, and a
# warm cargo cache that turns a multi-minute cold build into seconds — and `-l` links the
# working tree, so a file missing from `package.json` still resolves.
#
# So this packs the plugin the way npm would, hands the tarball to a released OpenClaw
# inside a container, and reports what happened. Four things it can catch that a local
# link cannot:
#
#   1. packaging      — only what `files` ships is there
#   2. the toolchain  — no Rust, no headers, or a cold cargo cache (timed)
#   3. protocol drift — a released `openclaw`, not the fork this was cut from
#   4. uninstall      — nothing left behind
#
# Usage:
#   ./fresh-install.sh                 every variant
#   ./fresh-install.sh cold            one variant
#   ./fresh-install.sh --display cold  pass this desktop's screen in, so it can draw
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin="$(cd "$here/.." && pwd)"
work="${TMPDIR:-/tmp}/colai-fresh-install"
share_display=0
declare -a wanted=()

for arg in "$@"; do
  case "$arg" in
    --display) share_display=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) wanted+=("$arg") ;;
  esac
done

# name:WITH_RUST:WITH_HEADERS:what it proves
VARIANTS=(
  "no-rust:0:1:says the Rust toolchain is missing, and installs anyway"
  "no-headers:1:0:says the GTK and WebKit headers are missing, and installs anyway"
  "cold:1:1:builds from an empty cargo cache — this is the number that matters"
)

if [ ${#wanted[@]} -eq 0 ]; then
  wanted=(no-rust no-headers cold)
fi

# An installed plugin loads compiled JavaScript, not TypeScript — OpenClaw's install
# validator says so plainly, and only a source checkout gets the TS fallback. So the
# runtime output is built first, into `dist/`, which `files` then ships.
repo="$(cd "$plugin/../.." && pwd)"
echo "building the plugin runtime"
(cd "$repo" && node --import ./scripts/tsx.mjs scripts/check-plugin-npm-runtime-builds.mts \
  --package extensions/colai)

# One tarball for every variant: exactly what `npm publish` would upload, and the only
# thing any container is allowed to see of this repo.
mkdir -p "$work"
rm -f "$work"/colai-toolbar-*.tgz
echo "packing $plugin"
tarball="$work/$( (cd "$plugin" && npm pack --pack-destination "$work" --silent) | tail -1 )"
echo "packed $(basename "$tarball") ($(du -h "$tarball" | cut -f1))"
echo

declare -a results=()

for variant in "${wanted[@]}"; do
  spec=""
  for candidate in "${VARIANTS[@]}"; do
    [ "${candidate%%:*}" = "$variant" ] && spec="$candidate"
  done
  if [ -z "$spec" ]; then
    echo "unknown variant: $variant" >&2
    exit 2
  fi
  IFS=: read -r name with_rust with_headers proves <<< "$spec"

  echo "=== $name — $proves"
  image="colai-fresh:$name"
  docker build \
    --build-arg "WITH_RUST=$with_rust" \
    --build-arg "WITH_HEADERS=$with_headers" \
    -t "$image" -f "$here/Dockerfile" "$here" >/dev/null

  declare -a screen=()
  if [ "$share_display" = "1" ] && [ -n "${DISPLAY:-}" ]; then
    # The last mile: a toolbar compiled inside the container, drawn on this desktop.
    screen=(-e "DISPLAY=$DISPLAY" -v /tmp/.X11-unix:/tmp/.X11-unix)
  fi

  began=$(date +%s)
  # No cargo cache mount, deliberately — a cold build is the thing being measured.
  if docker run --rm "${screen[@]+"${screen[@]}"}" \
      -v "$tarball:/work/$(basename "$tarball"):ro" \
      "$image" bash -euo pipefail -c "
        # --accept-capabilities because nothing in here can answer a prompt. A person
        # installing this is shown the same surface and accepts it themselves.
        openclaw plugins install 'npm-pack:/work/$(basename "$tarball")' --force --accept-capabilities
        echo
        echo '--- what doctor says'
        openclaw doctor --severity info 2>&1 | grep -i colai || echo '(colai said nothing about itself)'
        echo
        echo '--- is the toolbar there'
        binary=\$(find ~/.openclaw -type f -name colai-toolbar 2>/dev/null | head -1)
        if [ -n \"\$binary\" ]; then
          echo \"built: \$binary (\$(du -h \"\$binary\" | cut -f1))\"
        else
          echo 'NOT BUILT — no colai-toolbar anywhere under ~/.openclaw'
        fi
        echo
        echo '--- uninstall'
        openclaw plugins uninstall colai --force
        left=\$(find ~/.openclaw -name '*colai*' 2>/dev/null | head)
        if [ -n \"\$left\" ]; then echo 'LEFT BEHIND:'; echo \"\$left\"; exit 1; fi
        echo 'nothing left behind'
      "; then
    took=$(( $(date +%s) - began ))
    results+=("$name|ok|${took}s|$proves")
  else
    took=$(( $(date +%s) - began ))
    results+=("$name|FAILED|${took}s|$proves")
  fi
  echo
done

echo "=================================================================="
printf '%-12s %-8s %-8s %s\n' variant result took proves
for row in "${results[@]}"; do
  IFS='|' read -r name result took proves <<< "$row"
  printf '%-12s %-8s %-8s %s\n' "$name" "$result" "$took" "$proves"
done
echo "=================================================================="
echo
echo "A container has no screen, so none of this proves the overlay draws."
echo "Run one variant with --display for that, at least once."

for row in "${results[@]}"; do
  case "$row" in *"|FAILED|"*) exit 1 ;; esac
done
