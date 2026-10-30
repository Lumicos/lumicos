# Proposed GitHub metadata — not applied

Read-only API check on 30 October 2026: repository public, default branch `main`, MIT license, empty description/topics, Discussions disabled, no releases, private vulnerability reporting disabled. No existing `.github` workflow or community templates were found before this branch.

## About description

Local-first AI assistant for Windows: local GGUF chat, editable memory and Pattara voice, with experimental image workflows and background agents.

## Topics

`local-ai`, `ai-assistant`, `ai-agent`, `llama-cpp`, `gguf`, `rocm`, `comfyui`, `windows`, `self-hosted`, `open-source`

All describe public code or its license; `ai-agent` and `comfyui` refer to experimental implementations. Do not add `davinci-resolve`, general `mcp-client` or `macos` before delivering those features.

## Owner-only changes after approval

GitHub CLI was not available on the audit PATH; write permission was not tested. The owner can paste the fields into About, or review these commands once authenticated:

```powershell
gh repo edit Lumicos/lumicos --description "Local-first AI assistant for Windows: local GGUF chat, editable memory and Pattara voice, with experimental image workflows and background agents."
gh repo edit Lumicos/lumicos --add-topic local-ai,ai-assistant,ai-agent,llama-cpp,gguf,rocm,comfyui,windows,self-hosted,open-source
```

Separately consider enabling Discussions for setup/hardware questions, and **enable private vulnerability reporting before launch**. These settings were not changed. No website URL or maintainer email is invented. README badges are only license/platform/stars; no release, Python-wide compatibility or unrun CI badge is advertised.
