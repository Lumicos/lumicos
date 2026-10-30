# v0.2.3-beta — Experimental Windows Pre-release

**ยังไม่เคยทดสอบติดตั้งบนเครื่องอื่น**

**This installer has never been tested on another computer.** A complete fresh installation, including runtime and model downloads, has not been validated. This is an unsigned Windows 11 x64 experimental installer, not a stable release or a hardware compatibility certification. Use a new installation folder.

## Included

- Public Lumicos snapshot with local GGUF chat and experimental knowledge, memory, voice-call, image and agent features; see the feature status document for boundaries.
- Pattara-only speech option. Microsoft Pattara must be installed separately in Windows.
- Bilingual installation and contributor documentation included in the package.
- No model weights bundled; runtime/model downloads require internet and upstream terms apply.

## Validation and limits

Installer tests, documentation link checks, embedded ZIP integrity, payload hashes and extract-only validation were performed. A CPU-fixture stage-only check was performed on the preceding packaging build. These checks do not constitute a complete installation or a GPU/inference test.

No other-PC installation, full runtime download, GPU compatibility, microphone/call or image end-to-end validation is claimed. The private production application's recent fixes and newer features are not automatically included in this public snapshot.

Assets: Lumicos-Setup.exe, Lumicos-Setup.exe.sha256 and BUILD-VALIDATION.json (exact source commit, checksum and validation scope).

The owner authorized this experimental publication with the above limitations disclosed. Outstanding clean-install and compatibility checklist items remain open.
