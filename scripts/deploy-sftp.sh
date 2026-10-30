#!/usr/bin/env bash
# Uploads a folder to public_html by SFTP. It owns exactly the files of the last upload, listed with
# their hashes in a manifest next to public_html: only changed files go up, and the only files it
# ever deletes are ones it uploaded earlier. Anything else on the host stays, and nothing outside
# public_html is touched except the manifest (never ~/alno-data).
#
# Hashed assets go first, pages after them, stale files last: at no moment does a page refer to a
# file that is not there yet. The manifest comes at the very end, so a run that dies is repaired by
# the next one.
#
# Usage: scripts/deploy-sftp.sh <folder>
# Env: SFTP_HOST SFTP_USER SFTP_PORT SFTP_KEY_FILE SFTP_KNOWN_HOSTS_FILE, FULL=true uploads everything.
set -euo pipefail

src=$(cd "$1" && pwd)
key=${SFTP_KEY_FILE/#\~/$HOME}
known=${SFTP_KNOWN_HOSTS_FILE/#\~/$HOME}
root=public_html
manifest=.alno-deploy-manifest
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

sftp() {
  lftp -c "set net:max-retries 3; set net:timeout 30; set sftp:auto-confirm no
set sftp:connect-program 'ssh -a -x -i $key -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$known'
open -u $SFTP_USER, -p $SFTP_PORT sftp://$SFTP_HOST
$1"
}

(cd "$src" && find . -type f | sed 's|^\./||' | LC_ALL=C sort) > "$work/files"
# The paths end up in lftp commands. A strange name stops the run instead of being quoted around.
if grep -qvE '^[A-Za-z0-9._@+/-]+$' "$work/files"; then
  echo "Unsafe file name in the upload:" >&2
  grep -vE '^[A-Za-z0-9._@+/-]+$' "$work/files" >&2
  exit 1
fi
(cd "$src" && while read -r f; do sha256sum "$f"; done < "$work/files") > "$work/new"

# Only a manifest that is really not there means a first upload. Any other failure stops the run: it
# would forget which files are stale, and they would stay public for good.
if ! out=$(sftp "get $manifest -o $work/old" 2>&1); then
  if ! printf '%s' "$out" | grep -qi 'no such file'; then
    echo "$out" >&2
    exit 1
  fi
  echo 'No manifest on the host: first upload.'
  : > "$work/old"
fi

LC_ALL=C sort "$work/new" > "$work/new.sorted"
LC_ALL=C sort "$work/old" > "$work/old.sorted"
# FULL uploads everything, but still knows what used to be there.
if [ "${FULL:-false}" = true ]; then
  cp "$work/files" "$work/changed"
else
  LC_ALL=C comm -13 "$work/old.sorted" "$work/new.sorted" | sed 's/^[0-9a-f]*  //' > "$work/changed"
fi
sed 's/^[0-9a-f]*  //' "$work/old.sorted" | LC_ALL=C sort -u > "$work/old.paths"
LC_ALL=C sort -u "$work/files" > "$work/new.paths"
LC_ALL=C comm -23 "$work/old.paths" "$work/new.paths" | grep -E '^[A-Za-z0-9._@+/-]+$' | grep -v '\.\.' > "$work/stale" || true
echo "$(wc -l < "$work/files") files, $(wc -l < "$work/changed") to upload, $(wc -l < "$work/stale") to delete"

stage="$work/stage"
mkdir -p "$stage"
(cd "$src" && while read -r f; do mkdir -p "$stage/$(dirname "$f")"; cp -p "$f" "$stage/$f"; done < "$work/changed")

up() { sftp "set cmd:fail-exit yes; mirror --reverse --no-perms --parallel=4 --verbose=1 $1 $2"; }
if [ -d "$stage/_astro" ]; then
  up "$stage/_astro" "$root/_astro"
  rm -rf "$stage/_astro"
fi
if [ -n "$(ls -A "$stage")" ]; then up "$stage" "$root"; fi

# Dotfiles are what keeps lib/ closed: if .htaccess did not arrive, this run has failed.
if [ -f "$src/wp-admin/.htaccess" ]; then
  sftp "get $root/wp-admin/.htaccess -o $work/htaccess"
  cmp "$src/wp-admin/.htaccess" "$work/htaccess"
fi

if [ -s "$work/stale" ]; then
  # A delete that fails stops the run before the manifest: the next run tries again.
  sftp "set cmd:fail-exit yes
$(sed "s|^\(.*\)$|rm -f $root/\1|" "$work/stale")"
  # Folders left empty; rmdir refuses the others, which is what we want.
  while read -r f; do
    d=$(dirname "$f")
    while [ "$d" != . ]; do echo "$d"; d=$(dirname "$d"); done
  done < "$work/stale" | sort -ru | sed "s|^\(.*\)$|rmdir $root/\1|" > "$work/rmdir"
  sftp "$(cat "$work/rmdir")" || true
fi

sftp "put $work/new -o $manifest"
