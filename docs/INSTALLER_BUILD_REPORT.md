# Installer build follow-up — 30 October 2026

> Publication update (30 October 2026): the owner authorized v0.2.3-beta as an experimental Pre-release. **This installer has never been tested on another computer.** Full fresh installation remains unvalidated. Earlier unpublished/build-audit statements below describe the previous audit, not completion of those remaining checks. See [release notes](RELEASE_NOTES_v0.2.3-beta.md).

Documentation branch commit cb230e0 was pushed with owner authorization to docs/open-source-launch-20261030. This follow-up is isolated on installer/package-readiness-20261030. Installer changes and the EXE have not been pushed/published; no GitHub Release was created.

## Changes

- Include both READMEs, docs/charts and community policies in the embedded single-file package.
- Run the local documentation checker before packaging; verify again after extraction.
- Align the Bootstrap banner with package version 0.2.3.
- Replace the test's developer-specific directory assumption with a synthetic nonempty-folder fixture.
- Update installation/contributor/release-checklist notes to reflect the fixed packaging gates.

Core application, model loader, memory, GPU scheduling, payload manifest, dependencies and original branding remain unchanged. Public Pattara-only behavior is preserved. No private installation files were copied into the package. The earlier standalone installer in another workspace remains untouched.

## Validation actually performed

- Documentation: 16 Markdown files / 124 internal links and images passed.
- Installer tests: 19/19 passed in source, then 19/19 passed from the extracted EXE package.
- Windows C# launcher and single-file EXE compilation passed.
- ZIP CRC and every manifest payload hash verified by the builder; 480 packaged files.
- `Lumicos-Setup.exe --extract-only <new-folder>` returned exit 0, with no installer GUI or application launch.
- Extracted CLI `stage --root <new-isolated-folder> --hardware tests/fixtures/cpu.json` returned exit 0. Payload copying and installation configuration completed with a synthetic CPU fixture, and state is `staged-only`.
- Git diff and final payload integrity checks confirmed no application/core/payload changes.

Generated artifacts: `dist/Lumicos-Setup.exe`, its `.sha256`, and `dist/BUILD-VALIDATION.json` containing final provenance/checksum. These are local build artifacts, not GitHub release assets. The binary is unsigned and the source follow-up is uncommitted; identify it by SHA256 rather than claiming an immutable release tag.

## Not tested / release gates remaining

Staging deliberately returns before runtime downloads, Python/GPU installation, sandbox ACL setup and model linking. It is **not** a complete installation test. Full clean-install/resume/uninstall, ROCm transitive DLL/kernel provisioning, target-driver compatibility, model inference, microphone/calls, images and end-to-end quality remain unverified for this public package. The developer's existing working environment is not evidence of those gates.

Use [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) before any public EXE upload. No AI services were stopped/restarted and no GPU workload ran. No paid service, global environment modification, production change, force push, merge or release publication occurred. The owner separately approves any installer source push or Release upload.
