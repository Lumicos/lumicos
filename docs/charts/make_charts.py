"""Lumicos benchmark charts (static PNG for a GitHub/Hugging Face README).
Every number below is copied from a measured result file; source noted per chart."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
import os

OUT = os.path.dirname(os.path.abspath(__file__))
SURFACE = "#fcfcfb"; INK = "#0b0b0b"; INK2 = "#52514e"; MUTED = "#8a8984"; GRID = "#e6e5e0"
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
GRAY = "#b9b8b2"

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 10.5, "text.color": INK,
    "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "axes.facecolor": SURFACE, "figure.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.spines.top": False, "axes.spines.right": False, "axes.spines.left": False,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8, "axes.axisbelow": True,
})

def frame(ax, title, sub, source):
    ax.set_title(title, loc="left", fontsize=13.5, fontweight="bold", color=INK, pad=26)
    ax.text(0, 1.035, sub, transform=ax.transAxes, fontsize=10, color=INK2, va="bottom")
    ax.figure.text(0.01, 0.01, source, fontsize=8.2, color=MUTED, ha="left", va="bottom")

def hbars(ax, labels, values, colors, fmt, xmax, height=0.56):
    y = range(len(labels))[::-1]
    for yi, v, c in zip(y, values, colors):
        ax.barh(yi, v, height=height, color=c, edgecolor=SURFACE, linewidth=2)
        ax.text(v + xmax * 0.012, yi, fmt(v), va="center", fontsize=10, color=INK)
    ax.set_yticks(list(y)); ax.set_yticklabels(labels, color=INK)
    ax.set_xlim(0, xmax); ax.grid(axis="y", visible=False); ax.tick_params(axis="y", length=0)

def save(fig, name):
    fig.savefig(os.path.join(OUT, name), dpi=160)
    plt.close(fig)

# 1 ── generation speed per model -------------------------------------------------
fig, ax = plt.subplots(figsize=(10, 4.4)); fig.subplots_adjust(left=0.40, right=0.95, top=0.80, bottom=0.17)
labels = ["Gemma 4 E4B  (Q5_K_M, all on GPU)", "Gemma 4 26B-A4B  (QAT Q4_0, offload + MTP)",
          "Gemma 4 26B-A4B  (in Lumicos, KV q8)", "Qwen3.6 35B-A3B  (offload + MTP)",
          "Gemma 4 26B-A4B  (old way: split layers)"]
vals = [46.4, 22.9, 23.2, 18.6, 13.6]
hbars(ax, labels, vals, [BLUE, BLUE, BLUE, ORANGE, GRAY], lambda v: f"{v:.1f} tok/s", 55)
ax.set_xlabel("Generation speed (tokens per second, higher is better)")
frame(ax, "How fast each model answers on an 8 GB RX 6600",
      "llama.cpp ROCm on Windows. MoE models park experts in system RAM",
      "Sources: llama-bench tg128 (E4B, -ngl split) and llama-server Thai prompts ~1.2k tok, 25 & 29 Oct 2026. Lumicos value = mean of 3 replies.")
save(fig, "01-model-speed.png")

# 2 ── MoE expert offload sweep (one method: llama-bench, Q4_K_M) ---------------------
fig, ax = plt.subplots(figsize=(9, 4.4)); fig.subplots_adjust(left=0.09, right=0.95, top=0.80, bottom=0.2)
ncmoe = [30, 26, 24, 22, 20, 18, 12]; tg = [14.1, 15.4, 16.3, 17.1, 14.8, 11.3, 6.9]
ax.plot(ncmoe, tg, color=BLUE, linewidth=2, solid_capstyle="round", zorder=3)
ax.scatter(ncmoe, tg, s=46, color=BLUE, edgecolor=SURFACE, linewidth=2, zorder=4)
ax.axvspan(11, 21, color="#f0efec", zorder=0)
ax.text(20.6, 7.4, "too many experts on the GPU:\nVRAM spills, speed collapses", fontsize=9.5, color=INK2, ha="right")
ax.annotate("sweet spot 17.1 tok/s", xy=(22, 17.1), xytext=(25.5, 18.4), fontsize=10, color=INK,
            arrowprops=dict(arrowstyle="-", color=INK2, lw=1))
ax.axhline(13.6, color=GRAY, linewidth=1.5); ax.text(30.8, 13.0, "best plain layer split (-ngl): 13.6", fontsize=9, color=INK2, ha="left", va="top")
ax.set_xlim(31, 11); ax.set_ylim(0, 20)
ax.set_xlabel("-ncmoe  (number of layers whose experts stay in system RAM; fewer = more on GPU)")
ax.set_ylabel("tok/s")
frame(ax, "Finding the MoE offload sweet spot (Gemma 4 26B-A4B)",
      "Q4_K_M, no MTP. Moving more experts to the GPU helps until the 8 GB card overflows",
      "Source: llama-bench pp2048/tg128, t=6, flash-attn on, 25 Oct 2026. With QAT Q4_0 + MTP the same sweep peaks at 22.9 tok/s (-ncmoe 22).")
save(fig, "02-moe-offload-sweep.png")

# 3 ── coding accuracy -------------------------------------------------------------
fig, ax = plt.subplots(figsize=(9, 3.9)); fig.subplots_adjust(left=0.30, right=0.95, top=0.78, bottom=0.18)
labels = ["Gemma 4 26B-A4B", "Qwen3.6 35B-A3B", "Gemma 4 E4B"]
vals = [97, 70, 30]
hbars(ax, labels, vals, [BLUE, ORANGE, AQUA], lambda v: f"{v}%", 110)
ax.text(97 + 1.3, 2 - 0.36, "29/30 runs", fontsize=8.5, color=INK2)
ax.text(70 + 1.3, 1 - 0.36, "7/10", fontsize=8.5, color=INK2)
ax.text(30 + 1.3, 0 - 0.36, "3/10", fontsize=8.5, color=INK2)
ax.set_xlabel("Bugs fixed so the tests pass (%)")
frame(ax, "Multi-file bug fixing: the 26B MoE is worth the wait",
      "10 bugs where the cause can sit in another file. Thinking off, temp 0.2",
      "Source: _bench/bugfix2, graded by running each case's tests, 28-29 Oct 2026. 26B = 10 bugs x 3 runs; others 1 run each. Harder 20-bug set: 26B 85%.")
save(fig, "03-coding-accuracy.png")

# 4 ── settings for coding: accuracy and time side by side -----------------------------
fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4.3), sharey=True, gridspec_kw={"wspace": 0.08})
fig.subplots_adjust(left=0.30, right=0.97, top=0.76, bottom=0.2)
labels = ["Thinking off, temp 0.2", "+ explain cause first", "Google default (temp 1.0)", "Thinking, budget 1024", "Thinking, budget 512"]
acc = [29, 27, 25, 25, 20]; secs = [27, 17, 21, 87, 54]
cols = [BLUE, GRAY, GRAY, GRAY, GRAY]
hbars(a1, labels, acc, cols, lambda v: f"{v}/30", 34)
hbars(a2, labels, secs, cols, lambda v: f"{v} s", 100)
a1.set_xlabel("Passing answers (of 30)"); a2.set_xlabel("Median time per bug (s)")
a1.set_title("Gemma 26B: the simplest setting won on accuracy", loc="left", fontsize=13.5, fontweight="bold", pad=26)
a1.text(0, 1.035, "Same 10 bugs x 3 runs. Letting the model 'think' made it slower and less accurate", transform=a1.transAxes, fontsize=10, color=INK2, va="bottom")
fig.text(0.01, 0.01, "Source: _bench RESULTS-20261028.md, phase A, 29 Oct 2026. Stream cut at the first closed code block (stops the model repeating itself).", fontsize=8.2, color=MUTED)
save(fig, "04-coding-settings.png")

# 5 ── long Thai documents vs context size --------------------------------------------
fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 3.9), sharey=True, gridspec_kw={"wspace": 0.08})
fig.subplots_adjust(left=0.20, right=0.97, top=0.74, bottom=0.21)
labels = ["8k ctx (6k-token doc)", "16k ctx (12k doc)", "32k ctx (24k doc)"]
hbars(a1, labels, [83, 90, 80], [BLUE, BLUE, BLUE], lambda v: f"{v}%", 105)
hbars(a2, labels, [20.6, 16.2, 16.2], [AQUA, AQUA, AQUA], lambda v: f"{v:.1f} tok/s", 26)
a1.set_xlabel("Questions answered correctly"); a2.set_xlabel("Chat speed with that profile")
a1.set_title("Reading long Thai documents (Gemma 26B, KV cache q8)", loc="left", fontsize=13.5, fontweight="bold", pad=26)
a1.text(0, 1.035, "More context did not buy much accuracy and cost ~20% speed. 8k stays the default", transform=a1.transAxes, fontsize=10, color=INK2, va="bottom")
fig.text(0.01, 0.01, "Source: _bench/thai-longctx, 30 questions (32k: 10), 29 Oct 2026. Common miss: answering 'not in the document' when it is.", fontsize=8.2, color=MUTED)
save(fig, "05-long-context.png")

# 6 ── phone call latency (real calls) --------------------------------------------------
fig, ax = plt.subplots(figsize=(9.5, 3.6)); fig.subplots_adjust(left=0.20, right=0.95, top=0.70, bottom=0.27)
rows = [("Normal question", [1.09, 0.0, 2.84]), ("Needs a web search", [1.12, 7.68, 4.34])]
names = ["Speech-to-text", "Web search + page reading", "LLM + TTS to first audio"]
cols = [AQUA, ORANGE, BLUE]
for yi, (lab, parts) in zip([1, 0], rows):
    left = 0
    for p, c in zip(parts, cols):
        if p > 0:
            ax.barh(yi, p, left=left, height=0.5, color=c, edgecolor=SURFACE, linewidth=2)
        left += p
    ax.text(left + 0.2, yi, f"{left:.1f} s", va="center", fontsize=10.5, color=INK, fontweight="bold")
ax.set_yticks([1, 0]); ax.set_yticklabels([r[0] for r in rows], color=INK)
ax.set_xlim(0, 16); ax.grid(axis="y", visible=False); ax.tick_params(axis="y", length=0)
ax.set_xlabel("Seconds from the end of your sentence to the first word you hear (median)")
handles = [plt.Rectangle((0, 0), 1, 1, color=c) for c in cols]
ax.legend(handles, names, loc="upper left", bbox_to_anchor=(0, 1.13), ncol=3, frameon=False, fontsize=9.5)
frame(ax, "Phone call mode: how long until it starts talking", "",
      "Source: data/logs/call-timing.jsonl, real calls 26-30 Oct 2026 (45 normal turns, 16 search turns). Segments are medians of each stage.")
save(fig, "06-call-latency.png")

# 7 ── video: VAE decode fix ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(9, 3.6)); fig.subplots_adjust(left=0.34, right=0.95, top=0.76, bottom=0.2)
labels = ["Standard VAE decode", "Tiled decode (default tiles)", "Tiled, temporal tile covers clip"]
hbars(ax, labels, [299.7, 103.3, 72.7], [GRAY, BLUE, BLUE], lambda v: f"{v:.0f} s", 340)
ax.set_xlabel("Seconds to decode one clip (lower is better)")
frame(ax, "Video: decoding was the bottleneck, not sampling",
      "Wan 2.2 5B Turbo, 640x352, 49 frames. Sampling itself took ~24 s",
      "Source: ComfyUI /history timings, RX 6600, 20 Oct 2026. Default tiles also caused a colour jump every 12 frames; full-clip temporal tile fixed it.")
save(fig, "07-video-vae-decode.png")

# 8 ── image-to-video render time ----------------------------------------------------------
fig, ax = plt.subplots(figsize=(9, 3.9)); fig.subplots_adjust(left=0.30, right=0.95, top=0.78, bottom=0.18)
labels = ["480x640, 97 frames", "480x640, 121 frames", "576x768, 97 fr (Q4_K_M)", "576x768, 97 fr (Q6_K)", "576x768, 97 fr, 8 steps"]
hbars(ax, labels, [338, 596, 709, 741, 994], [BLUE, BLUE, BLUE, AQUA, GRAY], lambda v: f"{v/60:.1f} min", 1150)
ax.set_xlabel("Total render time (s)")
frame(ax, "Image-to-video render time on 8 GB (Wan 2.2 5B Turbo)",
      "4 sampling steps unless noted. Q6_K looked better than Q4_K_M for ~30 s more",
      "Source: ComfyUI runs, 20 Oct 2026. No GPU crashes with full-clip tiled decode. 832x480 was not attempted (crashed earlier).")
save(fig, "08-video-i2v-time.png")

print("ok")

# 9 ── image generation inside Lumicos (real jobs) ---------------------------------------------
import matplotlib.pyplot as plt  # noqa: E402 (kept self-contained when appended)
fig, ax = plt.subplots(figsize=(9, 3.9)); fig.subplots_adjust(left=0.27, right=0.95, top=0.78, bottom=0.18)
labels = ["624x832 portrait  (n=101)", "832x624 landscape  (n=14)", "720x720 square  (n=10)", "1024x576 wide  (n=11)"]
hbars(ax, labels, [37.6, 37.9, 42.8, 53.6], [BLUE, BLUE, BLUE, BLUE], lambda v: f"{v:.0f} s", 65)
ax.set_xlabel("Median seconds per image, request to finished image")
frame(ax, "Image generation: about 40 seconds per picture on 8 GB",
      "Z-Image Turbo (INT8), 8 steps, ComfyUI on PyTorch ROCm under Windows",
      "Source: Lumicos image-jobs log, 157 real images, 15-26 Oct 2026. Includes waiting for the GPU and occasional model loads; slowest single image 478 s.")
save(fig, "09-image-generation.png")
print("ok9")
