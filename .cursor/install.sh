#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for Delegation Cloud.
# Runs after the repository is checked out. Must terminate and be safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."

# The software-context adapter (scripts/software-context-shunt.mjs, exercised by
# `npm test` and `npm run context:read`) requires Git that understands the
# top-level `--no-lazy-fetch` flag, added in Git 2.45. Ubuntu 24.04 ships 2.43,
# so ensure a new-enough Git from the git-core PPA when needed.
ensure_modern_git() {
  local required_major=2 required_minor=45
  local version major minor
  version="$(git --version | awk '{print $3}')"
  major="${version%%.*}"
  minor="$(printf '%s' "$version" | cut -d. -f2)"
  if [ "$major" -gt "$required_major" ] || { [ "$major" -eq "$required_major" ] && [ "$minor" -ge "$required_minor" ]; }; then
    echo "Git $version already satisfies >= ${required_major}.${required_minor}."
    return 0
  fi
  echo "Git $version is too old; installing >= ${required_major}.${required_minor} from git-core PPA."
  sudo add-apt-repository -y ppa:git-core/ppa
  sudo apt-get update -qq
  sudo apt-get install -y --only-upgrade git
  echo "Git upgraded to $(git --version | awk '{print $3}')."
}

ensure_modern_git

# Deterministic dependency install from the committed lockfile.
npm ci

echo "Delegation Cloud install complete."
