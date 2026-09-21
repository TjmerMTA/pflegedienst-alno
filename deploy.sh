#!/bin/bash
# Сборка и выкладка на GitHub Pages (ветка gh-pages). Домен берётся из public/CNAME.
set -e
cd "$(dirname "$0")"
SITE_URL="${SITE_URL:-https://dev.siteboosty.com}" npm run build
cd dist
git init -q -b gh-pages
git add -A
git commit -qm "deploy $(date -u +%Y-%m-%dT%H:%MZ)"
git push -f https://github.com/TjmerMTA/pflegedienst-alno.git gh-pages
rm -rf .git
