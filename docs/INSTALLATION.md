# Installation and build notes

> Publication update (30 October 2026): the owner authorized v0.2.3-beta as an experimental Pre-release. **This installer has never been tested on another computer.** Full fresh installation remains unvalidated. Earlier unpublished/build-audit statements below describe the previous audit, not completion of those remaining checks. See [release notes](RELEASE_NOTES_v0.2.3-beta.md).

## Current release status

The repository is a source snapshot (package version 0.2.3). GitHub has no releases/assets as checked on 30 October 2026. A developer-local EXE exists outside this checkout, but it is not a verified public distribution of this commit. Do not use a fabricated download link or copy that EXE into a release without provenance and clean-install testing.

## Prerequisites and flow

### One-line install (no manual ZIP)

From any CMD or PowerShell window (Windows 11 x64):

```bat
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Lumicos/lumicos/main/install.ps1 | iex"
```

[`install.ps1`](../install.ps1) forces TLS 1.2 where needed, downloads `https://github.com/Lumicos/lumicos/archive/refs/heads/main.zip` with `Invoke-WebRequest`, extracts to `%TEMP%\lumicos-<timestamp>`, runs [`Install.cmd`](../Install.cmd) with the same interactive console attached (`cmd /c`, no new window), and removes the temp ZIP/folder **only on success**. Failures keep the temp tree for diagnosis and print Thai + English messages. Paths with spaces or Thai characters use `-LiteralPath`. The bootstrap does **not** request elevation; later sandbox ACL steps may still need admin on some machines (see below). [`get.cmd`](../get.cmd) is a tiny local wrapper for the same one-liner after you already have a checkout.

**Visibility caveat:** unauthenticated `raw.githubusercontent.com` and the archive ZIP require a **public** repository. If the repo is made private, this one-liner will fail until you clone with credentials or ship another distribution channel.

### Install.cmd / Bootstrap flow

[Install.cmd](../Install.cmd) invokes Windows PowerShell with a process-local execution-policy bypass, then [Bootstrap.ps1](../Bootstrap.ps1):

1. Detect hardware and require Windows 11 x64, build 22000 or later.
2. **Install folder (no prompt):** default `C:\Lumicos` (a subfolder, not the drive root). Override with Bootstrap `-Root`, `cli --root`, or `LUMICOS_ROOT`. If `C:\Lumicos` cannot be created/written (ACL), fall back to `%LOCALAPPDATA%\Lumicos` with a clear Thai/EN message.
3. Download checksum-pinned Node.js 24.21.0 into `.bootstrap`; no global Node installation is required for the end-user bootstrap.
4. **Exactly two interactive screens**, then a fully unattended install (Ctrl+C still cancels):
   - **Screen 1 — GPU backend** (single-select `(*)` / `( )`): options and the preselected default come from hardware detection (`detect.ps1` + `profile.mjs`) — AMD → ROCm preselected (+ Vulkan/CPU); NVIDIA → CUDA 13 or 12.4 per driver/RTX 50 rules (+ Vulkan/CPU); Intel/unknown → Vulkan or CPU. Unsupported backends are not listed. Header shows detected GPU name / VRAM / driver (and CUDA max when NVIDIA); recommended tagged `แนะนำ`. Choice drives `llama` / `torch` / `whisper` / images gating. Override with `--backend` / `LUMICOS_BACKEND` / Bootstrap `-Backend`.
   - **Screen 2 — models** (multi-select): chat GGUF, Whisper STT, Microsoft Pattara TTS, Z-Image / Image Lab. Same arrow-key UX as before.
5. After Screen 2 there are **no further prompts**: no install-folder question, no GPU-index question, no “install this plan?” confirm, no separate CPU-Whisper confirm (selecting STT on a CPU-Whisper backend accepts CPU Whisper; declining STT skips it). Non-TTY / `--yes` / `LUMICOS_AUTO_MODELS=1` uses recommended backend + models; pin with `--models=…` / `--skip-*`.
6. [Installer](../src/install.mjs) copies the verified payload, downloads selected runtimes, creates isolated environments, configures sandbox ACLs and builds the app. Inspect administrative requirements for sandbox setup on a fresh machine; do not promise an entirely privilege-free install.
7. Read generated `MODELS.html` (lists only the models you selected). Either use `Download Recommended Models.cmd` after accepting upstream terms, or download manually to the listed destinations and run `Link Downloaded Models.cmd`.
8. Run `Check Installation.cmd`, then `Start Lumicos.cmd`. Existing occupied service ports are meant to stop startup, not authorize killing other services.

Runtime and model network access is required during setup. The installer's disk check is an **estimate**, not a measurement: 15GiB without images, 80GiB with images ([CLI](../src/cli.mjs)). Keep headroom for downloads, Python environments and temporary files. Low RAM receives a warning; 32GB is the developer reference, not a universal requirement.

Microsoft Pattara must already be installed in Windows for speech output. If absent, install Thai text-to-speech under Windows language settings; Lumicos does not ship Microsoft voice files or choose another TTS voice. Speech input uses pinned whisper.cpp CUDA or CPU profiles; AMD selection currently uses CPU Whisper.

ROCm/CUDA selection and runtime downloads are in [profile.mjs](../src/profile.mjs), [downloads.json](../catalog/downloads.json) and [install.mjs](../src/install.mjs). Web search (`SearchV6Service`) uses `LUMICOS_SEARCH_DIR` / `LUMICOS_SEARCH_PYTHON` from the install `environment.json` (written by [configure.mjs](../src/configure.mjs) and loaded by `Start Lumicos.cmd`); if unset, it derives `<installRoot>/LumicosSearchMCP` and `<installRoot>/Lumicos-Sandbox/python/python.exe` from the PersonalAI location, with `C:/AI/...` only as a last-resort legacy fallback. A compatible GPU driver remains necessary. Do not install a system-wide ROCm/CUDA toolkit merely because a label appears here; the installer supplies selected runtime components, and compatibility must be checked on the target machine. GPU image setup uses Python 3.12.10 for cu124 or 3.13.9 for other selected GPU profiles; there is no one Python-version badge covering every component.

## Known issues and verification gates

- **Windows Git line endings:** payload hashes describe repository bytes. This branch adds `.gitattributes` to prevent conversion; an older clone with `core.autocrlf=true` can fail checksum validation. Do not disable verification or regenerate hashes to conceal unexpected changes. Use a fresh checkout including the attributes.
- **Bootstrap banner:** aligned with package version 0.2.3 in the installer follow-up.
- **Build packaging:** the installer follow-up now bundles both READMEs, community policies and `docs/`. Documentation links are checked before packaging and again after EXE extraction. See [build report](INSTALLER_BUILD_REPORT.md).
- **ROCm dependencies:** verify that the pinned Windows ROCm archive and installation path provide hipBLAS/rocBLAS dependencies and the selected architecture kernels. The private developer's working environment does not prove a clean install will load ROCm.
- **Knowledge setup:** embedding runtime/model configuration exists, but complete clean-install preparation is not established in this review. Do not promise offline retrieval before assets are present.
- **Tests:** the root-protection test now creates a synthetic nonempty directory instead of depending on a developer installation. Drive-root rejection uses `path.win32` so Linux CI matches Windows semantics. No all-green application CI badge is advertised.
- **Install-root paths:** Default install folder is `C:\Lumicos` (fallback `%LOCALAPPDATA%\Lumicos` if unwritable). Sandbox and Search MCP resolve under the chosen install folder via `environment.json` / sibling layout; `C:/AI/...` remains a legacy fallback only. GPU VRAM from `nvidia-smi` matches Win32 adapter names after stripping an optional `NVIDIA` / `NVIDIA Corporation` prefix.

## Build the single-file installer

Requires Node.js >=24, Python 3 on PATH for ZIP packaging, Windows PowerShell, and the Windows .NET Framework C# compiler used by the scripts. Full installation validation remains a separate release gate.

```powershell
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-launcher.ps1
npm run release
```

The first build step compiles `.build/Lumicos-Setup.exe`; **it alone does not create the single-file distribution**. `npm run release` creates `dist/Lumicos-Setup.exe` and its SHA256 file. Verify extraction in a new throwaway directory and then perform the full [release checklist](RELEASE_CHECKLIST.md). No signing or public release is implied by compilation.

## Stop / uninstall

The installed folder contains `Stop Lumicos.cmd`, which uses [owned-process checks](../src/stop.ps1). Do not run it on another installation or during someone else's work. No dedicated uninstaller was found. Back up chats, memories, workspace and downloaded models; stop only the installation you own, then archive its directory. Review the AppContainer/ACL setup separately before removing it; this audit has not verified cleanup of those system resources. No destructive uninstall command is prescribed.
