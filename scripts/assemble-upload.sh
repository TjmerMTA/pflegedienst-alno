#!/usr/bin/env bash
# Prepares the two docroots: <folder>/site for the public site (dist, with api/, nothing of the
# preview) and <folder>/admin for the admin, which is a separate origin and shares no file with it.
# Usage: scripts/assemble-upload.sh <empty folder>
set -euo pipefail

out=$1
for f in dist/index.html admin/public/wp-admin/index.html; do
  if [ ! -s "$f" ]; then echo "$f is missing or empty: nothing to deploy." >&2; exit 1; fi
done
rm -rf "$out"
mkdir -p "$out/site" "$out/admin"
cp -R dist/. "$out/site/"
for d in wp-admin admin-alno; do
  if [ -e "$out/site/$d" ]; then echo "dist must not contain $d/" >&2; exit 1; fi
done
cp -R admin/public/. "$out/admin/"
# GitHub Pages' own files, for the preview only.
rm -f "$out/site/CNAME" "$out/site/.nojekyll"
