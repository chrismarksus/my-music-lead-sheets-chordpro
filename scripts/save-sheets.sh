#!/usr/bin/env bash
# Stage, commit, and push new or changed lead sheets under sheets/.
set -euo pipefail

cd "$(dirname "$0")/.."

changes=$(git status --porcelain -- sheets/)

if [ -z "$changes" ]; then
  echo "No new or changed files under sheets/. Nothing to do."
  exit 0
fi

echo "$changes"

git add -- sheets/

files=$(git diff --cached --name-only -- sheets/ | xargs -n1 basename | sed 's/\.pro$//')
count=$(echo "$files" | wc -l)

if [ "$count" -eq 1 ]; then
  message="Add lead sheet for $files"
else
  message="Add/update $count lead sheets

$(echo "$files" | sed 's/^/- /')"
fi

git commit -m "$message"
git push
