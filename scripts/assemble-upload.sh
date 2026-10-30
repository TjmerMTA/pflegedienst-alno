#!/usr/bin/env bash
# Prepares the two docroots: <folder>/site for the public site (dist, with api/, nothing of the
# preview) and <folder>/admin for the admin, which is a separate origin and shares no file with it.
# Usage: scripts/assemble-upload.sh <empty folder>
set -euo pipefail

out=$1
rm -rf "$out"
mkdir -p "$out/site" "$out/admin"
cp -R dist/. "$out/site/"
if [ -e "$out/site/wp-admin" ]; then echo "dist must not contain wp-admin/" >&2; exit 1; fi
cp -R admin/public/. "$out/admin/"
# GitHub Pages' own files, for the preview only.
rm -f "$out/site/CNAME" "$out/site/.nojekyll"
