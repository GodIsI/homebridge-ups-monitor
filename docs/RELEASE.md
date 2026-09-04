# Release & Branching Policy

This document defines how versions, branches, and merges are managed for
`homebridge-ups-monitor`. It complements [`.github/AGENTS.md`](../.github/AGENTS.md).

## Branch model

| Branch | Role |
|--------|------|
| `main` | Stable, production. Published to npm `latest`; cuts a stable GitHub release. Fed **only** from `develop`. |
| `develop` | Integration branch. Published to npm `beta`; cuts beta pre-releases. |
| `feature/*`, `agent/*`, `fix/*`, `chore/*` | Work branches, PR'd into `develop`. |

## Merge-method policy (the important rule)

- **Feature work → `develop`: squash merge.** Keeps `develop` history clean (one commit per change).
- **`develop` → `main` (promotion): merge commit — never squash.**
- **`main` → `develop` (version sync-back): merge commit — never squash.**

### Why this matters

A squash merge creates a brand-new commit on the target branch; the source
commits are **not** preserved as ancestors. When the `develop`↔`main` syncs are
squashed, the two branches stop sharing a recent common ancestor. Because both
branches bump `package.json`'s `version` line independently (patch bumps on
`develop`, minor bumps on `main`), the next merge sees the version line changed
on *both* sides relative to a stale common ancestor and **conflicts** — every
release cycle.

Using a real merge commit for the two sync directions keeps `main`'s version
commits as genuine ancestors of `develop` (and vice-versa), so the version line
is only ever "changed on one side" and merges cleanly.

> GitHub branch rulesets can't allow "squash for feature PRs but merge-commit
> for sync PRs" on the same target branch, so the merge-method rule is enforced
> by **convention** at merge time. The structural safeguard below removes the
> reliance on remembering it for the `main → develop` direction.

## Structural safeguard: ancestry-preserving sync-back

`sync-develop.yml` (which carries the bumped version from `main` back to
`develop` after a release) performs a **true `git merge origin/main`** and the
resulting PR is auto-merged with `--merge` (not `--squash`). This guarantees
`main` remains an ancestor of `develop` regardless of merge-button choices.

## Versioning

Versions are bumped automatically by CI — **never edit `package.json` `version`
by hand** (see AGENTS.md):

- **PATCH** — every feature PR merged into `develop` (`version-patch.yml`).
- **MINOR** — every `develop → main` release (`version-minor.yml`).

Beta builds are published as `X.Y.Z-beta.<commit-count>`, where the suffix is
derived from `git rev-list --count HEAD` so the npm version matches the GitHub
pre-release tag.

## Release notes and changelog

`CHANGELOG.md` is the source of truth for release notes. The patch/minor version
bump workflows regenerate it from conventional commits before opening the
version-bump PR.

`beta.yml` and `release.yml` then use the top `CHANGELOG.md` section as the
GitHub release body. They do not use GitHub's auto-generated release notes,
because those can include older compare ranges and automated version-bump noise.

## Re-running `release.yml` or `publish.yml` after a partial failure

`release.yml` uses `softprops/action-gh-release@v3`. If the `v*` tag already
exists, the action does **not** move or recreate that tag — `target_commitish`
only applies when the tag is first created. It updates the existing GitHub
Release in place instead (name, body, and assets are overwritten; assets
default to `overwrite_files: true`). The tag itself is separately protected by
the org `protect-releases` ruleset (deletion and update blocked, no bypass),
but that protection is about the git ref, not about whether the release object
can be refreshed — the two are independent.

Recovery therefore depends on which step actually failed:

- **`release.yml` failed before or during the GitHub Release step:** safe to
  re-run. The tag is unchanged and protected; the action reuses it and
  updates the release/assets idempotently.
- **`publish.yml` (npm) failed:** don't blindly re-run. Check npm first — npm
  versions are immutable, and a timeout or interrupted response can leave the
  actual publish outcome uncertain. If the version is confirmed *not*
  published, re-running `publish.yml` for the same commit/version is fine.
- **Source or release content needs to change:** don't hand-edit
  `package.json` or the tag — use the normal automated version-bump flow
  (`version-patch.yml`/`version-minor.yml`) to cut a fresh version instead.
- **Never** delete, recreate, or force-move the protected release tag as a
  recovery step.

## Resolving a `develop → main` version conflict (if it ever recurs)

1. Merge `main` into `develop` via an `agent/*` PR, resolving `package.json` to
   develop's version.
2. Merge that PR with a **merge commit** (not squash).
3. The `develop → main` promotion PR will then merge cleanly.
