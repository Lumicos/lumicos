# Developer benchmark archive — not a public release certification

Existing tracked chart sources: [English plotting script](charts/make_charts.py), [Thai plotting script](charts/make_charts_th.py). These contain numbers previously published by the developer, mainly from the private daily build, 20–30 October 2026. No benchmark was run for this documentation task and no private measurements were imported.

Reference system: Ryzen 5 3600, Radeon RX 6600 8GB, 32GB RAM, Windows 11, ROCm. The chart source reports:

| Measurement | Reported value | Method / configuration shown in source |
|---|---:|---|
| Gemma 4 E4B | 46.4 tok/s | Q5_K_M, GPU; llama-bench tg128 |
| Gemma 4 26B-A4B | 22.9 tok/s | QAT Q4_0, expert offload + MTP; llama-server Thai prompts around 1.2k tokens |
| 26B plain layer split | 13.6 tok/s | llama-bench; different offload setup |
| 26B MoE sweep peak | 17.1 tok/s | Q4_K_M, no MTP, -ncmoe 22, pp2048/tg128, threads6, FA on, 25 Oct |

Do not compare mixed llama-bench and server workloads as a controlled speedup, infer quality from speed, or apply these profiles to every 8GB GPU. The original logs, complete prompts/seeds, executable hashes and per-repetition timings referenced by the plotting scripts are not included. Independent reproduction of these values from this repository alone is therefore incomplete.

The old README's blanket statement that MoE cache never helps has been removed: no universal cache conclusion follows from these archived workloads. No new cache numbers are introduced here.

## Existing charts

![Model speeds, mixed methods](charts/01-model-speed.png)
![Expert offload sweep](charts/02-moe-offload-sweep.png)

Additional original charts: [coding](charts/03-coding-accuracy.png), [coding settings](charts/04-coding-settings.png), [long context](charts/05-long-context.png), [call latency](charts/06-call-latency.png), [image models](charts/10-image-models.png), [image timing](charts/09-image-generation.png). They retain their original claims and sample sizes; availability of a chart does not establish availability of the model/workflow in the public installer. [Thai chart source and assets](charts/th).

Historical video experiments: [VAE decode](charts/07-video-vae-decode.png), [image-to-video](charts/08-video-i2v-time.png). These are private experiments, not advertised Lumicos video-generation or Resolve features.

For a publishable comparison, attach sanitized raw logs, commit/build/runtime and driver versions, GPU/CPU/RAM, GGUF revision/quantization, offload/KV/FA/MTP flags, token counts, cache state, seeds, repetitions and errors. Keep comparable workloads separate. Only benchmark an idle authorized GPU; never stop other AI applications without permission.
