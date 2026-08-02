#!/usr/bin/env bash
# Symlink this repo's skills (develop-party-time, deploy-party-time,
# diagnose-party-time, party-time-create-event, plus any others added here
# such as add-vitest) into ~/.claude/skills so they load no matter which
# directory Claude Code is working from. Builds and deploys both run from
# this repo now, but the symlink still matters when working from a sibling
# repo (e.g. homelab) where repo-local skills would otherwise be invisible.
# homelab's own generic skills (e.g. fix-homelab-mdns) are linked separately
# by homelab/scripts/link-skills.sh.
#
# Idempotent. Refuses to clobber a real directory that isn't one of our symlinks.
set -uo pipefail

REPO_SKILLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.claude/skills"
DEST="$HOME/.claude/skills"

mkdir -p "$DEST"

status=0
linked=0
skipped=0

for src in "$REPO_SKILLS"/*/; do
    [ -d "$src" ] || continue
    name="$(basename "$src")"
    target="$DEST/$name"

    if [ -L "$target" ]; then
        current="$(readlink "$target")"
        if [ "$current" = "${src%/}" ]; then
            printf '  ok       %s (already linked)\n' "$name"
            skipped=$((skipped + 1))
            continue
        fi
        printf '  relink   %s (was -> %s)\n' "$name" "$current"
        rm "$target"
    elif [ -e "$target" ]; then
        # A real file or directory lives here. Do not destroy someone's work.
        printf '  SKIP     %s — a real directory exists at %s, not replacing it\n' "$name" "$target" >&2
        status=1
        continue
    fi

    ln -s "${src%/}" "$target" && {
        printf '  linked   %s\n' "$name"
        linked=$((linked + 1))
    } || status=1
done

printf '\n%d linked, %d already current\n' "$linked" "$skipped"
[ "$status" -ne 0 ] && printf 'One or more skills were skipped — see messages above.\n' >&2
exit "$status"
