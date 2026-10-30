#!/usr/bin/env bash
# Puts everything that belongs into public_html into one folder: the built site (dist, with api/),
# the admin, and nothing of the preview. Usage: scripts/assemble-upload.sh <empty folder>
set -euo pipefail

out=$1
rm -rf "$out"
mkdir -p "$out"
cp -R dist/. "$out/"
if [ -e "$out/wp-admin" ]; then echo "dist must not contain wp-admin/" >&2; exit 1; fi
cp -R admin/public/wp-admin "$out/wp-admin"
cp admin/public/wp-login.php "$out/wp-login.php"
# GitHub Pages' own files, for the preview only.
rm -f "$out/CNAME" "$out/.nojekyll"
