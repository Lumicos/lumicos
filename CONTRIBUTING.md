# Contributing to Lumicos

Thanks for helping make local AI usable on everyday PCs. This is an early Windows-first snapshot. Read [feature status](docs/FEATURE_STATUS.md) and the [code of conduct](CODE_OF_CONDUCT.md).

## Report a bug or propose a feature

Use the bug, feature or hardware issue template. Include a minimal synthetic example, exact commit/version, expected versus actual behavior, and sanitized logs. Explain the user problem before proposing an implementation. Do not attach chats, memory databases, personal documents, credentials, full environment dumps or model weights. Vulnerabilities belong in the [private reporting process](SECURITY.md), not a public bug report.

## Development and tests

Work in a separate clone/branch, never a live installation. Node.js >=24 is needed for the source tests. Windows 11 x64 is required for the installer and Windows integrations.

```powershell
git switch -c docs/my-improvement
node scripts/check-docs.mjs
npm test
```

The existing installer suite has a host-dependent personal-directory assertion; see [known issues](docs/INSTALLATION.md). A missing dependency is not an application regression. Record exact commands, OS, failures and skips.

For application work, from `payload/PersonalAI`:

```powershell
npm ci
npm run build
node --test server/test/knowledgeFoundation.test.mjs server/test/knowledgeRouter.test.mjs
```

Use relevant additional tests for a change. Do not run every GPU/model test for documentation. Model/voice/image integration checks require separate assets, available hardware and explicit permission to use it. Never stop another user's services. Never alter payload source merely to make a hash check green: after a deliberate reviewed source change, regenerate its manifest with a reviewed reproducible process and inspect the diff; this documentation branch changes no payload bytes.

## Pull requests

Keep one concern per branch; explain the problem, resulting behavior, tests and remaining risks. Keep English/Thai README facts in sync. Cite public code or tests for features; distinguish private experiments. Preserve the logo and existing copyright/license notices. Screenshots must be real, sanitized and permission-cleared.

Inspect `git diff --check`, `git diff --stat` and staged files before committing. Do not commit install state, models, temporary artifacts or secrets. Use a normal feature-branch PR; never force-push or rewrite shared history without maintainer coordination. Publication and repository-setting changes need the owner's approval.
