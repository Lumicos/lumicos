# Creative pipeline notes (developer reference)

Paraphrased from the November 2026 developer setup. This is **not** an installer feature checklist.

## Goal on the reference PC

1. Keep chat/agent work on local Gemma (llama.cpp).
2. Use ComfyUI for generative stills/video (Z-Image, Flux/Moss, MiniMax H3, LTX 2.5).
3. Optionally drive **ArtCraft** desktop apps through MCP for editing/assembly (PhotoCraft, FilmCraft, LightCraft, EffectCraft).
4. Let **Apollo** update llama.cpp / ComfyUI safely in a separate environment.

## MCP in Lumicos

Public payload now includes an optional MCP client under `payload/PersonalAI/server/mcp`:

- Config file: `data/mcp-config.json` (absent = nothing starts).
- Example: `payload/PersonalAI/server/mcp/example-config.json`.
- Tools appear as `<server>__<tool>` and go through the normal permission gate.
- Results are wrapped as untrusted text before the model sees them.

ArtCraft servers on the developer machine point at installed `*-cli.exe` binaries (PhotoCraft ~26 tools, FilmCraft ~17, LightCraft ~17 compact, EffectCraft ~27 in the notes from 2026-11-09). Those paths and binaries are **not** redistributed here.

## Film / video lab

On the RTX 5060 Ti setup, experimental routes include:

- MiniMax H3 Singularity V1.3 (merged turbo LoRA, NVFP4) with draft → upscale; optional RelayVSR ×2.
- LTX 2.5 NVFP4 for shorter clips with audio.
- Chat-side short-film helpers (`film_character` / `film_shot` / `film_assemble`, etc.) used privately; not fully merged into the public `comfyService` in this snapshot.

Measured timings stay in [BENCHMARKS.md](BENCHMARKS.md). Personal series scripts, character sheets and raw clips stay off GitHub.

## What belongs in a future public release

- MCP client (started here) + documented example servers that do not require paid/closed CLIs.
- Clear installer gates if Image Lab video is ever offered.
- Separate packaging/license review for any ArtCraft automation that others are expected to run.
