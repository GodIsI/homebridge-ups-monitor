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

## Re-running `release.yml` against an already-released version

`release.yml` uses `softprops/action-gh-release@v3`, which **updates** the
existing GitHub Release for a tag if one already exists — it does not fail.
So a manual re-run of the workflow after a partial failure (e.g. `publish.yml`
failing after the release step already succeeded) will silently edit the
existing release rather than error out.

The release tag itself is protected by the org `protect-releases` ruleset
(deletion and update blocked, no bypass), so retrying the same job against an
existing tag is not a safe recovery path even if you wanted to force it.

**Recovery:** don't retry the same release job. Cut a fresh version bump
(patch or minor, per the rules above) so CI creates a new tag and release from
scratch.

## Resolving a `develop → main` version conflict (if it ever recurs)

1. Merge `main` into `develop` via an `agent/*` PR, resolving `package.json` to
   develop's version.
2. Merge that PR with a **merge commit** (not squash).
3. The `develop → main` promotion PR will then merge cleanly.
