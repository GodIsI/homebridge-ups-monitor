# Contributing

Thanks for contributing to `homebridge-ups-monitor`.

This project follows the [Plimmerton Labs Engineering Playbook](https://github.com/Plimmerton-Labs/engineering-playbook). Changes should be easy to review, verified with evidence, and aligned with the Homebridge verification requirements documented in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Branches

- Branch from `develop`.
- Use `feature/<slug>` for human-authored features.
- Use `fix/<slug>` for bug fixes.
- Use `agent/<slug>` for AI-authored work.
- Open pull requests against `develop`, never directly against `main`.

## Local Checks

Run the test suite before committing:

```sh
npm test
```

For lint-only validation:

```sh
npm run lint
```

The test suite includes `test/verification.test.js`, which reproduces the Homebridge verification checks that must not regress.

## Pull Requests

Use the pull request template. Include:

- what changed and why;
- validation performed;
- assumptions;
- risks, limitations, and follow-up work;
- any `config.schema.json` changes that affect existing users.

Significant design, security, release, storage, or operational changes should add or update an ADR in `docs/decisions/`.

## AI Contributors

AI contributors must read [AGENTS.md](AGENTS.md) and [.github/AGENTS.md](.github/AGENTS.md) before changing files.
