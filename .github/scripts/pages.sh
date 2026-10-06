#!/usr/bin/env bash
# The published site lives on the gh-pages branch; every workflow goes through this script.
#
#   pages.sh fetch                    dist/ <- the published site (empty before the first publish)
#   pages.sh scan [path ...]          fail if dist/<path> (default: all of dist/) holds anything
#                                     that must never be published
#   pages.sh publish "<msg>" path ... replace those paths on gh-pages with dist/<path>
#
# gh-pages always holds a single commit. A publish takes the branch's current tree, swaps in
# only its own paths, and pushes that as a new parentless commit with --force-with-lease. If
# another refresh pushed in between, the lease fails and it starts again from the new tree, so
# projects refreshing at the same time never overwrite each other, and the branch does not grow
# with every refresh. GitHub Pages ("Deploy from a branch", gh-pages, / root) serves it.
set -euo pipefail
BR=gh-pages
cmd=${1:?usage: pages.sh fetch|scan|publish}
shift

case "$cmd" in
fetch)
  rm -rf dist && mkdir -p dist
  if git fetch -q --depth=1 origin "$BR" 2>/dev/null; then
    git archive FETCH_HEAD | tar -x -C dist
    echo "fetched $BR at $(git rev-parse --short FETCH_HEAD)"
  else
    echo "$BR does not exist yet; starting from an empty site"
  fi
  ;;

scan)
  targets=()
  if [ $# -eq 0 ]; then targets=(dist); else for p in "$@"; do targets+=("dist/$p"); done; fi
  fail=0
  for pat in 'accessToken' 'Bearer [A-Za-z0-9._-]\{8,\}' '[0-9a-fA-F]\{32,\}' \
             '[A-Za-z0-9._%+-]\+@[A-Za-z0-9.-]\+\.[A-Za-z]\{2,\}' 'visilean\.net' 'visilean\.com'; do
    if grep -rIn --binary-files=without-match -e "$pat" "${targets[@]}" >/dev/null 2>&1; then
      echo "::error::pattern '$pat' found in ${targets[*]}"
      grep -rIn --binary-files=without-match -e "$pat" "${targets[@]}" | cut -c1-200 | head -5
      fail=1
    fi
  done
  [ "$fail" = "1" ] && { echo "Refusing to publish."; exit 1; }
  echo "Credential scan clean: ${targets[*]}"
  ;;

publish)
  msg=${1:?publish needs a message}
  shift
  [ $# -gt 0 ] || { echo "publish needs at least one path"; exit 1; }
  for p in "$@"; do [ -e "dist/$p" ] || { echo "dist/$p does not exist"; exit 1; }; done
  root=$(git rev-parse --show-toplevel)
  export GIT_INDEX_FILE="$RUNNER_TEMP/pages-index"
  export GIT_AUTHOR_NAME="github-actions[bot]" GIT_COMMITTER_NAME="github-actions[bot]"
  export GIT_AUTHOR_EMAIL="41898282+github-actions[bot]@users.noreply.github.com"
  export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
  for attempt in 1 2 3 4 5 6; do
    rm -f "$GIT_INDEX_FILE"
    if git fetch -q --depth=1 origin "$BR" 2>/dev/null; then
      tip=$(git rev-parse FETCH_HEAD)
      git read-tree "$tip"
    else
      tip=""
      git read-tree --empty
    fi
    for p in "$@"; do
      (cd dist && git --git-dir="$root/.git" --work-tree=. rm -r -q -f --cached --ignore-unmatch -- "$p" \
                && git --git-dir="$root/.git" --work-tree=. add -f -- "$p")
    done
    tree=$(git write-tree)
    if [ -n "$tip" ] && [ "$tree" = "$(git rev-parse "$tip^{tree}")" ]; then
      echo "nothing changed on $BR"; exit 0
    fi
    commit=$(git commit-tree "$tree" -m "$msg")
    if git push -q --force-with-lease="refs/heads/$BR:$tip" origin "$commit:refs/heads/$BR"; then
      echo "published $* to $BR ($(git rev-parse --short "$commit"))"; exit 0
    fi
    echo "$BR moved while publishing (attempt $attempt); retrying on the new tree"
    sleep $((attempt * 5))
  done
  echo "::error::could not publish to $BR after 6 attempts"
  exit 1
  ;;

*)
  echo "unknown command: $cmd"; exit 1
  ;;
esac
