#!/usr/bin/env bash
# Usage: scripts/release.sh <version>   (for example 0.1.0)
#
# pnpm will not run `prepare` for a git-hosted package unless the consumer allows it,
# so the tag carries the built dist/. That commit is not on main: main stays source only.
# This script makes the commit and the tag. It pushes nothing.
set -euo pipefail

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: scripts/release.sh <version>  (for example 0.1.0)" >&2
  exit 2
fi
tag="v$version"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" ]]; then
  echo "Refusing: on '$branch', not main." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing: the working tree is not clean." >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "Refusing: tag $tag already exists." >&2
  exit 1
fi

pkg="$(node -p "require('./package.json').version")"
if [[ "$pkg" != "$version" ]]; then
  echo "Refusing: package.json version is $pkg, not $version." >&2
  exit 1
fi

pnpm build

git switch --detach
# If the commit or tag fails (for example, no git identity), unstage dist and go back to main.
trap 'git reset -q; git switch -q main' ERR
git add -f dist
git commit -m "Release $tag (built dist)"
git tag "$tag"
trap - ERR
git switch main

echo
echo "Created tag $tag on a commit that is not on main."
echo "Nothing was pushed. To publish:"
echo "  git push origin main"
echo "  git push origin $tag"
