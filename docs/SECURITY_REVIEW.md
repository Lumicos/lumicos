# Scoped repository security and hygiene review

Date: 30 October 2026. Baseline public commit `d5b43d6`. Review covers tracked files, installer boundaries and all **5 reachable commits / 467 unique blobs** fetched from the public repository, plus the proposed documentation changes. No code/secrets were uploaded to a scanner. No penetration test, dependency CVE audit, unreachable-object scan or audit of unshared branches was performed.

## Method and evidence

A local Python/standard-library scan streamed Git blobs with `git cat-file --batch`. Rules covered common GitHub/Hugging Face/OpenAI/AWS token shapes, private-key headers, long literal credential assignments, Windows user paths and private IPv4 addresses; binary data was excluded from text-pattern matching. File inventory checked generated state, weights, backups and objects over 10MiB. This is a limited heuristic scan, not gitleaks-equivalent coverage or proof that no secret exists. No dedicated secret scanner was installed on PATH.

Ten candidates were manually classified: private network ranges in `payload/LumicosSearchMCP/search_core.py` and URL-guard tests, synthetic password fixtures in `payload/PersonalAI/server/test/ownerAuth.test.mjs`, and a generic traversal-test user path in `payload/PersonalAI/server/test/service.test.mjs`. No confirmed live credential was identified. No full candidate value is reproduced here. No tracked weights or blobs over 10MiB were found. Commit identity metadata is public Git attribution; owner should confirm consent before promotion. History was not rewritten.

## Findings

| Severity | Finding / evidence | Action / status |
|---|---|---|
| Critical | No confirmed Critical finding in this scoped review | Not a security clearance. Rotate any subsequently confirmed exposed credential before history cleanup. |
| High | Private vulnerability reporting disabled; no verified private contact ([repository Security settings checked read-only](https://github.com/Lumicos/lumicos/security)) | Owner must enable private reporting before broad launch. SECURITY.md gives a non-sensitive channel-request fallback; no email invented. |
| Medium | Windows checkout newline conversion broke 378 payload hashes; Git blobs themselves matched the manifest | Fixed through `.gitattributes` preserving exact payload bytes; 19 installer tests pass afterward. Runtime/manifest unchanged. |
| Medium | `scripts/release.mjs` omits README.th.md and linked docs from its embedded archive | Release blocker for this documentation layout; documented for a separate reviewed packaging change. No installer published. |
| Medium | Generic machine defaults remain in `payload/PersonalAI/server/llama/modelConfig.mjs`, `server/sandbox/sandboxService.mjs`, `server/web/searchV6Service.mjs` and voice adapters | Not confirmed personal credentials; direct source startup can resolve unintended local paths. Installer supplies overrides for several paths. Fresh-machine smoke required; core kept unchanged. |
| Medium | No complete clean-install or transitive ROCm dependency validation of this public snapshot | Do not transfer confidence from private working installs. Gate binary release on real target checks. |
| Low | Tracked `payload/PersonalAI/server/llama/modelConfig.mjs.bak-20261025-moe` | Source backup, not live model settings; remains in tracked payload/manifest. Owner should remove in a separate reviewed package update; ignore rule alone does not untrack it. |
| Low | `.gitignore` lacked several generated/sensitive local patterns | Added bootstrap/detection/install state, environment files, secrets, backups and model-weight exclusions. Existing tracked content unaffected. |
| Low | Bootstrap displays 0.2.2 while package is 0.2.3 | Reported, not changed in this documentation scope. |
| Low | Existing installer test assumes a particular personal path exists; some application tests need uninstalled dependencies | Do not advertise a universal green CI result. Proposed CI checks docs only. |

Severity reflects launch/privacy and operational risk, not a claim that a remotely exploitable vulnerability was proven. Do not post private exploit details if further review discovers one.

## Other boundaries reviewed

[Owner authentication](../payload/PersonalAI/server/security/ownerAuth.mjs) uses salted scrypt records; [remote gateway](../payload/PersonalAI/server/http/remoteGateway.mjs) binds loopback and checks configured identity/origin. These files were inspected, not penetration-tested. The sandbox permits public internet and configured workspace writes; “local” does not mean network-free, and the old blanket “every write asks” wording was removed.

No new API keys, tokens, personal configuration, model weights, private voice data, private benchmark logs or owner-specific user paths were added. No history rewriting, force push, branch deletion, visibility changes or external scanning occurred. Follow [SECURITY.md](../SECURITY.md) and [release gates](RELEASE_CHECKLIST.md).
