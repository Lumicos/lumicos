# Work report — Lumicos open-source launch preparation

Date: 30 October 2026. Public baseline: `d5b43d6` from `https://github.com/Lumicos/lumicos`. Work is isolated on branch `docs/open-source-launch-20261030` in a separate clone. No production application, model configuration, engines, AI runtime, memory, agent scheduler or GPU loader was changed. No service was stopped, restarted or benchmarked.

## Delivered

- English/Thai README with the requested hero/tagline, original logo, verified license/platform/stars badges, concise source quick start and matching capability/limitation statements.
- Feature inventory with public implementation/test links and Available / Experimental / Planned / Private boundaries.
- Benchmark archive preserving published figures/charts and disclosing mixed methods and missing raw logs. No private benchmark results imported or new measurements invented.
- Installation notes, release checklist and **draft** v0.2.3-beta notes; no release candidate certified because full fresh install was not tested.
- Contributor/security/conduct policies; bug/feature/hardware issue forms and PR checklist.
- Proposed About/topics/Discussions actions, launch post drafts and a real-demo capture/script plan. Nothing posted or uploaded.
- Local docs checker and proposed read-only docs CI. GitHub Actions pinned to official v4 commit SHAs resolved during the audit. GitHub workflow execution not yet tested; no CI badge claimed.
- `.gitignore` protection and `.gitattributes` exact-byte payload checkout rule.

## Files changed / added

Modified: `README.md`, `README.th.md`, `.gitignore`.

Added: `.gitattributes`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`; `docs/FEATURE_STATUS.md`, `docs/INSTALLATION.md`, `docs/BENCHMARKS.md`, `docs/DEMO_CAPTURE_GUIDE.md`, `docs/GITHUB_METADATA.md`, `docs/RELEASE_CHECKLIST.md`, `docs/RELEASE_NOTES_v0.2.3-beta.md`, `docs/LAUNCH_POSTS.md`, `docs/SECURITY_REVIEW.md`, `docs/WORK_REPORT.md`; `.github/ISSUE_TEMPLATE/{bug_report,feature_request,hardware_report,config}.yml`, `.github/pull_request_template.md`, `.github/workflows/docs.yml`, `scripts/check-docs.mjs`.

No changes to `payload/`, `src/`, `catalog/`, original logo/charts, existing tests, package dependencies or model weights. The payload was rechecked out with exact Git bytes after adding attributes; no blob changed. Index stat metadata was refreshed to eliminate stale CRLF modification reports, without staging any payload content change.

## Validation

| Check | Outcome |
|---|---|
| Public repo / release / metadata API | Read-only: main, MIT, no releases, About/topics empty, Discussions off, private vulnerability reporting off |
| Initial installer tests | 18/19: payload integrity failed after Windows autocrlf conversion |
| Hash diagnosis | 378 checkout mismatches; all original Git blobs matched their manifest entries |
| After attributes | **19/19 installer tests passed**, manifest unchanged |
| Targeted application tests | **51 passed, 1 failed to load** across agentSchedule, knowledgeFoundation, knowledgeRouter and ownerAuth test files; ownerAuth blocked by absent `@xmldom/xmldom`, not a proven runtime regression |
| New documentation checker | PASS: 15 Markdown documents, 124 local links/images and bilingual factual markers |
| English/Thai review | Matching hardware caveats, Pattara-only, no public release, mixed-method benchmarks, experimental and private boundaries |
| History hygiene scan | 5 reachable commits / 467 blobs; 10 heuristic candidates reviewed as test fixtures/blocklists; no confirmed live credentials, no blob over 10MiB |
| Git attribution | One identity, GitHub noreply address; no raw author email copied into reports |
| Working/staged docs review | No new private configuration, private logs, weights or credentials identified; scope checked with Git diff |
| YAML | Manually reviewed issue-form/workflow structure; no local YAML parser installed; GitHub execution/rendering not run |
| Diff whitespace / core scope | Checked with `git diff --check` and path-restricted diff; source/runtime paths unchanged |
| Not run | Full application dependency install/build, fresh Windows install, GPU/model tests, live mic/call/image/agent demos, signed installer build, external link crawl of every URL, penetration/dependency-CVE audit |

The documentation checker is intentionally modest: it checks local link/image existence and shared factual markers, not semantic truth or full GitHub rendering. No network link checker or external secret scanning service was used. All source inspection and secret scanning stayed local; only public repository pages/metadata and Action tag metadata were fetched.

## Risks / owner decisions

Read [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for Critical/High/Medium/Low triage. No confirmed Critical exposure was found within the limited scan. Main launch gates:

1. Enable a verified private vulnerability channel and publish a private conduct contact; do not invent an email.
2. Review/fix release packaging so new docs and Thai README are included; resolve stale version text, ROCm dependency provisioning and any fresh-machine failures in separate reviewed changes.
3. Review tracked source backup and machine-default paths without deleting history or modifying production.
4. Complete clean-install matrix, real sanitized screenshot/demo and quality checks. Existing charts and developer-local EXE are not substitutes.
5. Approve About/topics and decide whether to enable Discussions.
6. Approve branch publication, PR, merge, exact release assets/tag and launch posts separately. No push, PR creation, metadata edits, release upload or publication occurred here.

## Review and optional PR commands

Changes are staged on the local branch for review; **no commit or push was made**. First inspect locally:

```powershell
git status --short
git diff --cached --stat
git diff --cached --check
git diff --cached
node scripts/check-docs.mjs
npm test
```

Only after the owner approves publishing these exact changes (and installs/authenticates GitHub CLI if desired):

```powershell
git commit -m "docs: prepare Lumicos public launch and community guidance"
git push -u origin docs/open-source-launch-20261030
gh pr create --repo Lumicos/lumicos --base main --head docs/open-source-launch-20261030 --title "Prepare public launch documentation and repository hygiene" --body-file docs/WORK_REPORT.md
```

These are proposed commands, not actions already taken. No force push or history rewrite. Rollback is simply to retain this isolated branch/clone without applying it to main; production requires no rollback. Do not delete branches or files automatically.
