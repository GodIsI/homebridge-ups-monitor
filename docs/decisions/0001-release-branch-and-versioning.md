# ADR-0001: Use develop-to-main release flow with automated version PRs

Date: 2026-06-27
Status: Accepted
Deciders: Plimmerton Labs Engineering

---

## Context

`homebridge-ups-monitor` is an npm-published Homebridge plugin. It needs a predictable path from development work to beta publication and stable release without direct pushes to protected branches.

The Plimmerton Labs operating model expects feature work to flow through `develop` before promotion to `main`, with evidence and review before promotion.

## Decision

The project uses this branch and release model:

- feature, fix, chore, and agent branches target `develop`;
- `develop` is the integration branch and publishes beta builds;
- `main` is the stable release branch and is fed only from `develop`;
- patch and minor version changes are opened by GitHub Actions as pull requests instead of direct pushes;
- `develop -> main` and `main -> develop` syncs use merge commits to preserve ancestry and avoid recurring version conflicts.

The detailed operational procedure lives in [docs/RELEASE.md](../RELEASE.md).

## Alternatives considered

| Option | Reason not chosen |
|--------|-------------------|
| Publish directly from feature branches | Makes release state hard to reason about and bypasses the integration branch. |
| Push version bumps directly to protected branches | Conflicts with the no-direct-push branch protection model. |
| Squash all release and sync PRs | Breaks ancestry between `develop` and `main`, causing recurring `package.json` version conflicts. |
| Manual version bumps in feature PRs | Easy for agents or contributors to get wrong and creates unnecessary review noise. |

## Consequences

### Positive

- Release state is traceable through pull requests.
- Branch protection remains meaningful for human and AI contributors.
- Beta and stable publishing have clear source branches.
- Version changes are isolated from feature implementation.

### Negative / Trade-offs

- Release automation is more complex than manual version edits.
- Some merge-method discipline remains required for `develop -> main` promotion.
- Maintainers must understand which workflows own versioning and publishing.

### Risks and mitigations

The main risk is accidental workflow or merge-method drift. This is mitigated by [docs/RELEASE.md](../RELEASE.md), [.github/AGENTS.md](../../.github/AGENTS.md), and CI checks that run before protected-branch promotion.

## Follow-up

- Keep branch protection required checks aligned with the CI matrix.
- Update this ADR if the release or publishing model changes materially.
