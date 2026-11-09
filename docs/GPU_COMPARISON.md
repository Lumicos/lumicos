# GPU before / after — RX 6600 8 GB → RTX 5060 Ti 16 GB

Developer reference machine only. Numbers come from local notes and `_bench` results on that PC; they are **not** a public-release certification. Workloads differ (llama-bench vs llama-server vs live chat vs ComfyUI). Do not treat every row as an apples-to-apples speedup. Missing figures are marked **ไม่มีข้อมูล**.

Migration date: **3 November 2026**. Same host otherwise: Ryzen 5 3600, 32 GB RAM, Windows 11, PCIe 3.0.

## Summary table

| Topic | Before (RX 6600 8 GB) | After (RTX 5060 Ti 16 GB) |
|---|---|---|
| GPU API | ROCm / gfx1032 | CUDA 13 (Blackwell) |
| Dedicated VRAM | 8 GB | 16 GB |
| Daily llama.cpp | b11723 ROCm | CUDA builds; Apollo tracks **b12182** (rollback b12110; migration day b12032) |
| Daily Whisper | CPU in public profile; private ROCm experiments existed | CUDA Whisper (`whisper-cuda`); ~0.6–0.8 s for a ~5.1 s Thai clip in migration checks |
| ComfyUI / torch | PyTorch ROCm under Windows | PyTorch `2.14.1+cu130` |
| Primary chat model that fits comfortably | E4B daily; 26B with heavy expert offload | 26B A4B QAT + MTP as primary (`-ncmoe` ~4–5) |
| E4B speed | **46.4 tok/s** (`llama-bench` tg128, Q5_K_M) | Dedicated post-migration E4B GPU chat tok/s: **ไม่มีข้อมูล** (E4B is used for calls; CPU-only translate tests were ~9 tok/s) |
| 26B chat speed | **~22–24 tok/s** live / **22.9 tok/s** published MTP offload profile | **~80–85 tok/s** early after move (`-ncmoe 4`, ctx 8k); later live **~82 tok/s** (`-ncmoe 5`, 32k/slot) |
| Z-Image stills | Warm direct ComfyUI **~26 s** (576×768 INT8); Lumicos job medians **~38–54 s** (includes queue/load) | NVFP4 workflow timing **13.9 s** (one recorded bench); Apollo ComfyUI health baseline **9.1 s** (512px-class health image) |
| Short video (~5 s) | Experimental / private charts only; not a daily production path on 8 GB | MiniMax H3 Singularity V1.3 NVFP4 + sparse: about **~171–188 s** for 1344×768 124 frames; film-studio clip recorded at **179.5 s**. Exact “3m49s” figure from memory: **ไม่มีข้อมูลในไฟล์** |
| What became practical | Local chat + careful image jobs on 8 GB | Larger context (32k/slot), faster 26B agent work, NVFP4 image/video stacks (H3, LTX 2.5), RelayVSR upscale, Apollo maintenance agent |

## Backend and software stack

| Layer | Before | After |
|---|---|---|
| Chat backend | `ggml-hip` / ROCm | CUDA llama.cpp |
| Image backend | ComfyUI + ROCm PyTorch | ComfyUI + CUDA 13 PyTorch |
| STT | CPU Whisper in public docs | CUDA Whisper verified on migration day |
| TTS (public story) | Microsoft Pattara on CPU | Unchanged as public default; OmniVoice CUDA used in private call experiments |
| Maintenance | Manual runtime swaps | [Apollo](APOLLO.md) snapshots, health checks, update/rollback |

## Chat / agent detail

| Measurement | RX 6600 | RTX 5060 Ti | Source class |
|---|---:|---:|---|
| E4B Q5_K_M tg128 | 46.4 tok/s | — | Published chart / [BENCHMARKS.md](BENCHMARKS.md) archive |
| 26B QAT + MTP (server / live) | ~22–24 tok/s typical; 22.9 published | ~80–85 then ~82 tok/s | Handoff + CLAUDE notes (paraphrased) |
| Apollo llama health baseline | — | 108 tok/s (Gemma 26B primary health prompt) | `apollo/versions.json` on the PC |
| Qwen3.6 35B A3B trial | ~17–22 tok/s (earlier ROCm trials) | ~40 tok/s but ~1 GB RAM free → dropped | Local notes |

## Image and video detail

| Workload | RX 6600 | RTX 5060 Ti |
|---|---|---|
| Z-Image Turbo | ~26 s warm ComfyUI (INT8); ~40 s median inside Lumicos jobs | 13.9 s recorded NVFP4 bench; 9.1 s Apollo health baseline |
| Flux / Moss / Qwen stills | Flux3 ~24 s, Moss ~26 s, Qwen ~45–55 s (warm 576×768 ROCm) | NVFP4 variants installed 2026-11-05; dedicated latency matrix on 5060 Ti: **ไม่มีข้อมูล** for a full re-bench in the notes used here |
| MiniMax H3 ~5 s | ไม่มีข้อมูล as a daily 8 GB path | Sparse 1344×768 ~171 s/clip (4-clip story); merged draft 960×544 ~107 s; Krea→i2v→upscale route used in film tests |
| LTX 2.5 960×544 49 frames + audio | ไม่มีข้อมูล | NVFP4 **30 s warm / 58 s cold** (~1.2 s/step); GGUF Q4 fallback ~72–107 s |
| RelayVSR ×2 (1344×768 → 2688×1536, 124 frames) | ไม่มีข้อมูล | ~18 s warm / ~50 s cold |

## What the upgrade unlocked (qualitative)

- Keep **Gemma 26B + MTP** as the everyday agent model with much less expert offload pressure.
- Raise context (32k tokens per slot with two slots) while still chatting at ~80 tok/s class speeds.
- Run **NVFP4** image/video weights that need roughly a full 16 GB card.
- Treat short **local video** (H3 / LTX) as an experimental but daily-usable lab path, not only a chart curiosity.
- Add **Apollo** to update llama.cpp / ComfyUI with snapshots and rollbacks.

## Caveats

- Mixing `llama-bench`, live chat, and ComfyUI wall times is intentional history, not a controlled A/B.
- Private voice references, film character sheets, API keys and raw logs stay off this public repo.
- Public installer hardware table still lists RX 6600 as a supported detection target; this page documents the developer's own card change.
