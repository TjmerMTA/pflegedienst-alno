#!/usr/bin/env bash
# Uploads a folder to a docroot by SFTP. It owns exactly the files of the last upload, listed with
# their hashes in a manifest next to the docroot: only changed files go up, and the only files it
# ever deletes are ones it uploaded earlier. Anything else on the host stays, and nothing outside
# the docroot is touched except the manifest (never ~/alno-data).
#
# Hashed assets go first, pages after them, stale files last: at no moment does a page refer to a
# file that is not there yet. The manifest comes at the very end, so a run that dies is repaired by
# the next one.
#
# A folder that is not a whole site stops the run before anything moves: a build gone wrong must
# never look like «all those files are stale». ALLOW_SHRINK=true lets a real clean-up through.
#
# The admin's docroot lies inside the site's: the optional fourth argument names that subfolder, which
# this run neither uploads to nor deletes from, whatever its folder or the manifest say.
#
# Usage: scripts/deploy-sftp.sh <folder> <docroot on the host> <manifest file name> [foreign subfolder]
# Env: SFTP_HOST SFTP_USER SFTP_PORT SFTP_KEY_FILE SFTP_KNOWN_HOSTS_FILE, FULL=true uploads everything.
set -euo pipefail

src=$(cd "$1" && pwd)
if [ ! -s "$src/index.html" ] && [ ! -s "$src/wp-admin/index.html" ]; then
  echo "No index.html in $src: refusing to deploy." >&2
  exit 1
fi
key=${SFTP_KEY_FILE/#\~/$HOME}
known=${SFTP_KNOWN_HOSTS_FILE/#\~/$HOME}
root=$2
manifest=$3
foreign=${4:-}
if [ -n "$foreign" ] && [ -e "$src/$foreign" ]; then
  echo "$foreign belongs to another docroot and must not be in $src: refusing to deploy." >&2
  exit 1
fi
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
# What this script could not have uploaded is not its own: never deleted, never counted, and gone from
# the manifest after this run. Only the number is printed: the text comes from the host, the log is public.
grep -E '^[A-Za-z0-9._@+/-]+$' "$work/old.paths" | grep -v '^/' | grep -v '\.\.' > "$work/old.safe" || true
if [ -n "$foreign" ]; then
  grep -v -e "^$foreign/" -e "^$foreign\$" "$work/old.safe" > "$work/old.own" || true
  mv "$work/old.own" "$work/old.safe"
fi
ignored=$(($(wc -l < "$work/old.paths") - $(wc -l < "$work/old.safe")))
if [ "$ignored" -gt 0 ]; then echo "$ignored unsafe paths in the manifest ignored." >&2; fi

old_count=$(wc -l < "$work/old.safe")
new_count=$(wc -l < "$work/files")
if [ "$old_count" -ge 10 ] && [ $((new_count * 2)) -lt "$old_count" ] && [ "${ALLOW_SHRINK:-false}" != true ]; then
  echo "Only $new_count files against $old_count in the last upload: refusing to deploy." >&2
  exit 1
fi

LC_ALL=C comm -23 "$work/old.safe" "$work/new.paths" > "$work/stale"
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

# Dotfiles are what keeps lib/ closed and sets the headers: if one did not arrive, this run has failed.
for f in .htaccess wp-admin/.htaccess wp-admin/lib/.htaccess; do
  if [ -f "$src/$f" ]; then
    rm -f "$work/htaccess"
    sftp "get $root/$f -o $work/htaccess"
    cmp "$src/$f" "$work/htaccess"
  fi
done

if [ -s "$work/stale" ]; then
  # A delete that fails stops the run before the manifest: the next run tries again.
  sftp "set cmd:fail-exit yes
$(sed "s|^\(.*\)$|rm -f $root/\1|" "$work/stale")"
  # Folders left empty; rmdir refuses the others, which is what we want.
  while read -r f; do
    d=$(dirname -- "$f")
    while [ "$d" != . ] && [ "$d" != / ]; do echo "$d"; d=$(dirname -- "$d"); done
  done < "$work/stale" | sort -ru | sed "s|^\(.*\)$|rmdir $root/\1|" > "$work/rmdir"
  sftp "$(cat "$work/rmdir")" || true
fi

sftp "put $work/new -o $manifest"
