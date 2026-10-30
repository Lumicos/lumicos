# Release checklist — proposed v0.2.3-beta

**Decision: draft notes only. No release candidate certified and no release published.** This review did not perform a fresh complete install. The earlier developer-local EXE is a separate artifact and must not be presented as a tested build of this branch.

## Repository and package gates

- [x] Public feature/source inventory and bilingual README prepared.
- [x] Original logo preserved; no fabricated screenshot.
- [x] Exact payload bytes preserved by `.gitattributes`; installer tests pass locally.
- [x] Local scoped history/working-tree hygiene review recorded.
- [ ] Owner reviews all branch changes and severity findings.
- [ ] Correct stale bootstrap version label in a separate reviewed change.
- [ ] Include README.th.md and linked docs in release packaging (current script omits them).
- [ ] Address tracked source backup and generic machine-path defaults with a separate runtime/package review.
- [ ] Verify all transitive runtime components, especially ROCm libraries/kernels, on a clean target.
- [ ] Confirm model terms/attribution and component licensing, including ComfyUI nodes.

## Fresh Windows 11 x64 validation

- [ ] Test fresh standard-user setup and document any required elevation for AppContainer/ACLs.
- [ ] Validate full install, download checksums, resume after failure and spaces/non-ASCII installation paths.
- [ ] Test AMD RX6600 and separately NVIDIA / CPU; do not generalize detection tests to certified compatibility.
- [ ] Verify selected driver/runtime, launch local GGUF, small response and clean owned-process shutdown.
- [ ] Verify Pattara present AND absent; absent must report unavailable, never choose another voice.
- [ ] Test microphone → Whisper → LLM → Pattara call, optional images, knowledge embedding assets and background jobs separately.
- [ ] Record actual disk usage and resource consumption; estimates are not measured requirements.
- [ ] Verify stop/uninstall/archive procedure without affecting unrelated AI services or deleting personal data.
- [ ] Scan clean installed output and final ZIP/EXE for sensitive data; record compiler, commit and SHA256.
- [ ] Extract final EXE and verify packaged links, languages, tests and payload manifest.
- [ ] Document unsigned status; signing is not implied and no paid service is required by this task.

## Community/publication gates

- [ ] Activate a verified private vulnerability channel and conduct-report contact.
- [ ] Owner approves About/topics; decide separately whether to enable Discussions.
- [ ] Capture real sanitized demo and review all launch copy.
- [ ] Run proposed docs workflow on GitHub only after approved push; no CI success claimed yet.
- [ ] Owner approves the exact commit/tag, binaries, checksums and release text.
- [ ] Publish v0.2.3-beta only after the gates; no automatic push, PR creation, tag or release upload from this task.

Draft text: [RELEASE_NOTES_v0.2.3-beta.md](RELEASE_NOTES_v0.2.3-beta.md).
