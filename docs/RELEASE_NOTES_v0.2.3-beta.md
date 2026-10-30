# v0.2.3-beta — DRAFT / NOT RELEASED

Lumicos is an early Windows 11 x64 local-first AI assistant. This proposed release would package the existing public GGUF chat, editable memory, Pattara-only speech and experimental knowledge, voice-call, ComfyUI and agent systems after clean-install validation.

Repository preparation adds clearer bilingual onboarding, public/private feature boundaries, contributor and security guidance, hardware/bug templates, benchmark provenance notes and exact-byte payload checkout rules. Core model, memory, agent and GPU code is unchanged by the documentation work.

## Known limitations

- No complete fresh-install verification for this candidate yet; no download link or binary attached.
- Hardware profiles are not compatibility guarantees. CPU/RAM offload may be required for large models.
- Microsoft Pattara must be installed separately in Windows; Whisper input may run on CPU.
- Weights are not bundled; upstream terms apply. Optional downloads/search/sandbox networking require internet.
- Private 26B/MTP profiles, general MCP/Resolve integration, newer call and automatic memory features are not part of this snapshot.
- No signed installer, broad hardware certification or end-to-end quality guarantee.

Before release, fill in the actual reviewed commit, build provenance, checksum, verified installation procedure and measured results. Follow [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). Do not replace these gaps with guesses.
