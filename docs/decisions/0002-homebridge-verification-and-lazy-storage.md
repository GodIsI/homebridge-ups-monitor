# ADR-0002: Treat Homebridge verification and lazy storage writes as hard gates

Date: 2026-06-27
Status: Accepted
Deciders: Plimmerton Labs Engineering

---

## Context

The plugin is intended for Homebridge users and is subject to Homebridge verification expectations. The verifier checks both package metadata and startup behaviour.

A failed plugin startup should not leave files behind, and a minimal configuration should degrade gracefully rather than crashing. This aligns with the Plimmerton Labs principles of trust, observability, maintainability, and protecting users from surprising side effects.

## Decision

Homebridge verification criteria are reproduced locally in `test/verification.test.js` and run as part of `npm test`.

The plugin must:

- start with only `{ "platform": "NUTDashboard" }`;
- catch and log startup and polling failures rather than throwing unhandled errors;
- avoid post-install scripts;
- keep Homebridge as a development dependency;
- keep `config.schema.json` and `PLATFORM_NAME` aligned;
- write persistent history, outage, and CSV files lazily, only after the first successful operation that needs them;
- write only inside the Homebridge storage directory.

## Alternatives considered

| Option | Reason not chosen |
|--------|-------------------|
| Rely on external Homebridge review only | Feedback would arrive late and regressions could reach users or reviewers. |
| Keep verification as a separate manual checklist | Easy to skip locally and invisible to CI. |
| Create storage files eagerly at startup | Failed installs and minimal configs would leave clutter and fail verifier expectations. |

## Consequences

### Positive

- Verification criteria are visible to contributors and agents.
- CI catches verifier regressions before review.
- Startup behaviour is safer for users and easier to reason about.
- Storage side effects happen only after useful plugin activity.

### Negative / Trade-offs

- Tests need to be updated whenever verifier-relevant behaviour changes.
- Lazy initialization requires slightly more care in storage and dashboard code.

### Risks and mitigations

The main risk is future contributors bypassing or weakening the verification test. This is mitigated by documenting the rule in [.github/AGENTS.md](../../.github/AGENTS.md), [docs/VERIFICATION.md](../VERIFICATION.md), and this ADR.

## Follow-up

- Keep [docs/VERIFICATION.md](../VERIFICATION.md) in sync with Homebridge verification expectations.
- Keep branch protection required checks aligned with the Node.js versions exercised by CI.
