# Apollo — local maintenance agent for Lumicos

**Apollo** is an optional, separate helper that lives beside a Lumicos install. It updates and health-checks **llama.cpp** and **ComfyUI**, can roll back failed swaps, and can attempt small bug fixes on a **copy** of the app code. It is part of the developer's Windows setup (built 2026-11-07). It is **not** shipped by the public Lumicos installer today.

Owner-facing rule of thumb: Apollo maintains the engines; Lumicos is the daily assistant.

## What Apollo is

| Piece | Role |
|---|---|
| Own Node runtime | Pinned `node.exe` under Apollo's `runtime/` (does not depend on Lumicos being up) |
| Pinned llama.cpp | Separate build used for Apollo's own brain (recorded as b12110 on the reference PC) |
| Brain model | Ternary **Bonsai** 27B Q2_0 GGUF — large context (128k q8 in the pinned args), ~9–13 GB VRAM depending on context |
| Tool CLI | `apollo.mjs` — status, baseline, health, update, rollback, prune |
| Optional chat UI | Local page (default `http://127.0.0.1:8096`) started by `Apollo.bat` |
| Bug-fix loop | Copies app code to a work folder, lets Bonsai edit the copy, re-runs tests; applying a fix needs an explicit confirm |

Apollo must **not** keep Bonsai loaded on the GPU at the same time as Lumicos's primary Gemma chat model.

## How it fits next to Lumicos

```text
Lumicos app  -->  llama-server (chat) + ComfyUI (images/video)
Apollo chat  -->  Bonsai on its own port  -->  tools that snapshot / update those engines
```

- Lumicos chooses its llama.cpp folder through `models.json` (`llamaDir`).
- Apollo installs candidate llama.cpp builds under `engines/llama.cpp/runtimes/<build>/`, runs a health check on a side port, and only switches the live pointer when confirmed (`--yes` / chat confirm card).
- ComfyUI updates are in-place with a snapshot first (code + custom nodes + root config + pip freeze; **not** model weights). Failure rolls back. Local patches inside custom nodes can be lost on a pack update and must be re-applied.
- Old runtimes are moved aside (not deleted) after a successful update; the owner deletes leftovers.

On the reference PC, Apollo's first real chat-driven update moved llama.cpp **b12110 → b12182**. Speed stayed in the same class as before in that A/B. Apollo also stores baselines (example: llama health **108 tok/s**, ComfyUI health image **9.1 s**).

## Typical commands (conceptual)

Exact flags live in the local `apollo/tools` tree on a machine that has Apollo installed. Conceptually:

1. `status` / `baseline` / `health` for llama.cpp or ComfyUI  
2. `update llama <zip|folder|bNNNNN>` — snapshot, install, health-check; switch only with explicit yes  
3. `rollback llama` — previous build  
4. Same pattern for `comfyui` (dry-run without yes; auto-rollback on failure)  
5. `fix --test <file>` — edit a **copy** only; `apply <job>` after the owner confirms  

The chat UI wraps the same tools behind confirm cards for destructive or GPU-heavy actions (timeout cancels an unanswered card). Read-only helpers can list updates from GitHub and search Hugging Face model cards with fit heuristics for this PC; they must not invent speeds.

## What Apollo is not

- Not a replacement for Lumicos chat, memory, Image Lab or voice calls.
- Not in the public ZIP/installer path or model catalog.
- Not allowed to delete production files; house rule is move-to-quarantine.
- Not a general internet agent: update intelligence is scoped (GitHub compare / HF read-only helpers), and GPU jobs stop the brain first.

## Relationship to public docs

- System layout after the CUDA move: [ARCHITECTURE.md](ARCHITECTURE.md)  
- Speed archive: [BENCHMARKS.md](BENCHMARKS.md)  
- Card change RX 6600 → RTX 5060 Ti: [GPU_COMPARISON.md](GPU_COMPARISON.md)  

If Apollo is ever packaged for others, it will need its own installer story, license review for the Bonsai weights and pinned runtimes, and a clear warning about GPU contention with Lumicos.
