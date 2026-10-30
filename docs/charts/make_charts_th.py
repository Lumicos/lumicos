"""Lumicos benchmark charts, Thai labels (generated from make_charts.py).
Every number below is copied from a measured result file; source noted per chart."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "th"); os.makedirs(OUT, exist_ok=True)
SURFACE = "#fcfcfb"; INK = "#0b0b0b"; INK2 = "#52514e"; MUTED = "#8a8984"; GRID = "#e6e5e0"
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
GRAY = "#b9b8b2"

plt.rcParams.update({
    "font.family": ["Loma", "DejaVu Sans"], "font.size": 11, "text.color": INK,
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
fig, ax = plt.subplots(figsize=(10, 4.4)); fig.subplots_adjust(left=0.40, right=0.95, top=0.80, bottom=0.24)
labels = ["Gemma 4 E4B  (Q5_K_M, อยู่บนการ์ดทั้งหมด)", "Gemma 4 26B-A4B  (QAT Q4_0, offload + MTP)",
          "Gemma 4 26B-A4B  (ใน Lumicos, KV q8)", "Qwen3.6 35B-A3B  (offload + MTP)",
          "Gemma 4 26B-A4B  (วิธีเดิม: แบ่งเลเยอร์)"]
vals = [46.4, 22.9, 23.2, 18.6, 13.6]
hbars(ax, labels, vals, [BLUE, BLUE, BLUE, ORANGE, GRAY], lambda v: f"{v:.1f} tok/s", 55)
ax.set_xlabel("ความเร็วตอบ (โทเคนต่อวินาที ยิ่งมากยิ่งดี)")
frame(ax, "แต่ละโมเดลตอบเร็วแค่ไหนบน RX 6600 8 GB",
      "llama.cpp ROCm บน Windows  โมเดล MoE ฝาก expert ไว้ใน RAM ของระบบ",
      "ที่มา: llama-bench tg128 (E4B, แบ่งเลเยอร์) และ llama-server พรอมต์ไทย ~1.2k โทเคน 25 และ 29 ต.ค. 2026  ค่าใน Lumicos = เฉลี่ย 3 คำตอบ")
save(fig, "01-model-speed.png")

# 2 ── MoE expert offload sweep (one method: llama-bench, Q4_K_M) ---------------------
fig, ax = plt.subplots(figsize=(9, 4.4)); fig.subplots_adjust(left=0.09, right=0.95, top=0.80, bottom=0.27)
ncmoe = [30, 26, 24, 22, 20, 18, 12]; tg = [14.1, 15.4, 16.3, 17.1, 14.8, 11.3, 6.9]
ax.plot(ncmoe, tg, color=BLUE, linewidth=2, solid_capstyle="round", zorder=3)
ax.scatter(ncmoe, tg, s=46, color=BLUE, edgecolor=SURFACE, linewidth=2, zorder=4)
ax.axvspan(11, 21, color="#f0efec", zorder=0)
ax.text(20.6, 7.4, "ย้าย expert ขึ้นการ์ดมากเกิน:\nVRAM ล้น ความเร็วตก", fontsize=9.5, color=INK2, ha="right")
ax.annotate("จุดที่ดีที่สุด 17.1 tok/s", xy=(22, 17.1), xytext=(25.5, 18.4), fontsize=10, color=INK,
            arrowprops=dict(arrowstyle="-", color=INK2, lw=1))
ax.axhline(13.6, color=GRAY, linewidth=1.5); ax.text(30.8, 13.0, "แบ่งเลเยอร์แบบเดิม (-ngl) ดีสุด: 13.6", fontsize=9, color=INK2, ha="left", va="top")
ax.set_xlim(31, 11); ax.set_ylim(0, 20)
ax.set_xlabel("-ncmoe  (จำนวนเลเยอร์ที่เก็บ expert ไว้ใน RAM  ยิ่งน้อย = อยู่บนการ์ดมากขึ้น)")
ax.set_ylabel("tok/s")
frame(ax, "หาจุด offload ที่ดีที่สุดของ MoE (Gemma 4 26B-A4B)",
      "Q4_K_M ไม่มี MTP  ย้าย expert ขึ้นการ์ดช่วยได้ จนกว่าการ์ด 8 GB จะล้น",
      "ที่มา: llama-bench pp2048/tg128, t=6, flash-attn เปิด, 25 ต.ค. 2026  ถ้าใช้ QAT Q4_0 + MTP จะสูงสุดที่ 22.9 tok/s (-ncmoe 22)")
save(fig, "02-moe-offload-sweep.png")

# 3 ── coding accuracy -------------------------------------------------------------
fig, ax = plt.subplots(figsize=(9, 3.9)); fig.subplots_adjust(left=0.30, right=0.95, top=0.78, bottom=0.25)
labels = ["Gemma 4 26B-A4B", "Qwen3.6 35B-A3B", "Gemma 4 E4B"]
vals = [97, 70, 30]
hbars(ax, labels, vals, [BLUE, ORANGE, AQUA], lambda v: f"{v}%", 110)
ax.text(97 + 1.3, 2 - 0.36, "29/30 รอบ", fontsize=8.5, color=INK2)
ax.text(70 + 1.3, 1 - 0.36, "7/10", fontsize=8.5, color=INK2)
ax.text(30 + 1.3, 0 - 0.36, "3/10", fontsize=8.5, color=INK2)
ax.set_xlabel("แก้บั๊กจนเทสต์ผ่าน (%)")
frame(ax, "แก้บั๊กหลายไฟล์: 26B MoE คุ้มที่จะรอ",
      "บั๊ก 10 ข้อ ที่สาเหตุอาจอยู่คนละไฟล์  ปิด thinking, temp 0.2",
      "ที่มา: _bench/bugfix2 ตรวจด้วยการรันเทสต์ของแต่ละข้อ 28-29 ต.ค. 2026  26B = 10 ข้อ x 3 รอบ, ที่เหลือรอบเดียว  ชุดยาก 20 ข้อ: 26B ได้ 85%")
save(fig, "03-coding-accuracy.png")

# 4 ── settings for coding: accuracy and time side by side -----------------------------
fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4.3), sharey=True, gridspec_kw={"wspace": 0.08})
fig.subplots_adjust(left=0.30, right=0.97, top=0.76, bottom=0.27)
labels = ["ปิด thinking, temp 0.2", "+ อธิบายสาเหตุก่อน", "ค่าแนะนำของ Google (temp 1.0)", "เปิด thinking งบ 1024", "เปิด thinking งบ 512"]
acc = [29, 27, 25, 25, 20]; secs = [27, 17, 21, 87, 54]
cols = [BLUE, GRAY, GRAY, GRAY, GRAY]
hbars(a1, labels, acc, cols, lambda v: f"{v}/30", 34)
hbars(a2, labels, secs, cols, lambda v: f"{v} วิ", 100)
a1.set_xlabel("คำตอบที่ผ่าน (จาก 30)"); a2.set_xlabel("เวลากลางต่อข้อ (วินาที)")
a1.set_title("Gemma 26B: ค่าที่เรียบง่ายที่สุดแม่นที่สุด", loc="left", fontsize=13.5, fontweight="bold", pad=26)
a1.text(0, 1.035, "บั๊ก 10 ข้อ x 3 รอบ  ให้โมเดล \"คิด\" ก่อน กลับช้าลงและแม่นน้อยลง", transform=a1.transAxes, fontsize=10, color=INK2, va="bottom")
fig.text(0.01, 0.01, "ที่มา: _bench RESULTS-20261028.md ช่วง A, 29 ต.ค. 2026  ตัดคำตอบเมื่อบล็อกโค้ดแรกปิด (กันโมเดลตอบวน)", fontsize=8.2, color=MUTED)
save(fig, "04-coding-settings.png")

# 5 ── long Thai documents vs context size --------------------------------------------
fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 3.9), sharey=True, gridspec_kw={"wspace": 0.08})
fig.subplots_adjust(left=0.20, right=0.97, top=0.74, bottom=0.28)
labels = ["ctx 8k (เอกสาร 6k โทเคน)", "ctx 16k (เอกสาร 12k)", "ctx 32k (เอกสาร 24k)"]
hbars(a1, labels, [83, 90, 80], [BLUE, BLUE, BLUE], lambda v: f"{v}%", 105)
hbars(a2, labels, [20.6, 16.2, 16.2], [AQUA, AQUA, AQUA], lambda v: f"{v:.1f} tok/s", 26)
a1.set_xlabel("ตอบถูก"); a2.set_xlabel("ความเร็วแชตของโปรไฟล์นั้น")
a1.set_title("อ่านเอกสารภาษาไทยยาว ๆ (Gemma 26B, KV cache q8)", loc="left", fontsize=13.5, fontweight="bold", pad=26)
a1.text(0, 1.035, "เพิ่ม context ไม่ได้แม่นขึ้นมาก แต่ช้าลง ~20%  จึงใช้ 8k เป็นค่าหลัก", transform=a1.transAxes, fontsize=10, color=INK2, va="bottom")
fig.text(0.01, 0.01, "ที่มา: _bench/thai-longctx 30 คำถาม (32k: 10 คำถาม), 29 ต.ค. 2026  ข้อผิดที่พบบ่อย: ตอบว่า \"ไม่มีในเอกสาร\" ทั้งที่มี", fontsize=8.2, color=MUTED)
save(fig, "05-long-context.png")

# 6 ── phone call latency (real calls) --------------------------------------------------
fig, ax = plt.subplots(figsize=(9.5, 3.6)); fig.subplots_adjust(left=0.20, right=0.95, top=0.66, bottom=0.34)
rows = [("คำถามทั่วไป", [1.09, 0.0, 2.84]), ("ต้องค้นเว็บ", [1.12, 7.68, 4.34])]
names = ["ถอดเสียง", "ค้นเว็บ + อ่านหน้าเว็บ", "LLM + TTS จนได้ยินเสียงแรก"]
cols = [AQUA, ORANGE, BLUE]
for yi, (lab, parts) in zip([1, 0], rows):
    left = 0
    for p, c in zip(parts, cols):
        if p > 0:
            ax.barh(yi, p, left=left, height=0.5, color=c, edgecolor=SURFACE, linewidth=2)
        left += p
    ax.text(left + 0.2, yi, f"{left:.1f} วิ", va="center", fontsize=10.5, color=INK, fontweight="bold")
ax.set_yticks([1, 0]); ax.set_yticklabels([r[0] for r in rows], color=INK)
ax.set_xlim(0, 16); ax.grid(axis="y", visible=False); ax.tick_params(axis="y", length=0)
ax.set_xlabel("วินาทีตั้งแต่พูดจบจนได้ยินคำแรก (ค่ากลาง)")
handles = [plt.Rectangle((0, 0), 1, 1, color=c) for c in cols]
ax.legend(handles, names, loc="upper left", bbox_to_anchor=(0, 1.2), ncol=3, frameon=False, fontsize=9.5)
frame(ax, "โหมดโทร: ต้องรอนานแค่ไหนกว่าจะเริ่มพูด", "",
      "ที่มา: data/logs/call-timing.jsonl สายจริง 26-30 ต.ค. 2026 (คำถามทั่วไป 45 ครั้ง, ค้นเว็บ 16 ครั้ง)  แต่ละช่วงคือค่ากลางของขั้นนั้น")
save(fig, "06-call-latency.png")

# 7 ── video: VAE decode fix ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(9, 3.6)); fig.subplots_adjust(left=0.34, right=0.95, top=0.76, bottom=0.27)
labels = ["VAE decode แบบปกติ", "Tiled decode (ค่าเริ่มต้น)", "Tiled, temporal tile ครอบทั้งคลิป"]
hbars(ax, labels, [299.7, 103.3, 72.7], [GRAY, BLUE, BLUE], lambda v: f"{v:.0f} วิ", 340)
ax.set_xlabel("วินาทีต่อคลิป (ยิ่งน้อยยิ่งดี)")
frame(ax, "วิดีโอ: คอขวดอยู่ที่ขั้น decode ไม่ใช่ sampling",
      "Wan 2.2 5B Turbo, 640x352, 49 เฟรม  ขั้น sampling ใช้แค่ ~24 วินาที",
      "ที่มา: เวลาจาก ComfyUI /history, RX 6600, 20 ต.ค. 2026  ค่าเริ่มต้นทำให้สีกระโดดทุก 12 เฟรม แก้ด้วย temporal tile ครอบทั้งคลิป")
save(fig, "07-video-vae-decode.png")

# 8 ── image-to-video render time ----------------------------------------------------------
fig, ax = plt.subplots(figsize=(9, 3.9)); fig.subplots_adjust(left=0.30, right=0.95, top=0.78, bottom=0.25)
labels = ["480x640, 97 เฟรม", "480x640, 121 เฟรม", "576x768, 97 เฟรม (Q4_K_M)", "576x768, 97 เฟรม (Q6_K)", "576x768, 97 เฟรม, 8 steps"]
hbars(ax, labels, [338, 596, 709, 741, 994], [BLUE, BLUE, BLUE, AQUA, GRAY], lambda v: f"{v/60:.1f} นาที", 1150)
ax.set_xlabel("เวลาเรนเดอร์ทั้งหมด (วินาที)")
frame(ax, "เวลาสร้างวิดีโอจากภาพบนการ์ด 8 GB (Wan 2.2 5B Turbo)",
      "4 steps ถ้าไม่ได้ระบุ  Q6_K สวยกว่า Q4_K_M แลกกับเวลาเพิ่ม ~30 วินาที",
      "ที่มา: รัน ComfyUI 20 ต.ค. 2026  ไม่มีการ์ดดับเมื่อใช้ tiled decode ครอบคลิป  ไม่ได้ลอง 832x480 (เคยดับมาก่อน)  สุดท้ายเลิกใช้เพราะช้าและผลไม่ดี")
save(fig, "08-video-i2v-time.png")

print("ok")

# 9 ── image generation inside Lumicos (real jobs) ---------------------------------------------
import matplotlib.pyplot as plt  # noqa: E402 (kept self-contained when appended)
fig, ax = plt.subplots(figsize=(9, 3.9)); fig.subplots_adjust(left=0.27, right=0.95, top=0.78, bottom=0.25)
labels = ["624x832 แนวตั้ง  (101 ภาพ)", "832x624 แนวนอน  (14 ภาพ)", "720x720 จัตุรัส  (10 ภาพ)", "1024x576 จอกว้าง  (11 ภาพ)"]
hbars(ax, labels, [37.6, 37.9, 42.8, 53.6], [BLUE, BLUE, BLUE, BLUE], lambda v: f"{v:.0f} วิ", 65)
ax.set_xlabel("วินาทีต่อภาพ (ค่ากลาง) ตั้งแต่สั่งจนได้ภาพ")
frame(ax, "สร้างภาพ: ประมาณ 40 วินาทีต่อภาพบนการ์ด 8 GB",
      "Z-Image Turbo (INT8), 8 steps, ComfyUI บน PyTorch ROCm ใต้ Windows",
      "ที่มา: log งานภาพของ Lumicos ภาพจริง 157 ภาพ 15-26 ต.ค. 2026  รวมเวลารอการ์ดและโหลดโมเดลบางครั้ง  ภาพที่ช้าที่สุด 478 วินาที")
save(fig, "09-image-generation.png")
print("ok9")

# 10 ── text-to-image model comparison (direct ComfyUI, warm) -------------------------------
fig, ax = plt.subplots(figsize=(9.5, 4.3)); fig.subplots_adjust(left=0.36, right=0.95, top=0.79, bottom=0.24)
labels = ["Flux.2 klein 4B  (Q4_K_M, 4 steps)", "Flux 3 klein 5.6B  (Q4_K_M, 4 steps)", "Z-Image Turbo  (INT8, 8 steps)",
          "Moss Image  (INT8 + 4-step LoRA)", "Qwen-Image 2.1  (Q4_K_M, 6 steps)"]
vals = [17.6, 24.0, 26.0, 26.0, 50.0]
hbars(ax, labels, vals, [GRAY, BLUE, BLUE, BLUE, GRAY], lambda v: f"{v:.0f} วิ" if v != 50.0 else "45-55 วิ", 62)
ax.set_xlabel("วินาทีต่อภาพ 576x768 เมื่อโหลดโมเดลไว้แล้ว")
frame(ax, "เทียบโมเดลสร้างภาพบนการ์ด 8 GB ใบเดียวกัน",
      "สีน้ำเงิน = ใช้ใน Lumicos, สีเทา = ลองแล้วไม่ใช้",
      "ที่มา: ComfyUI บน PyTorch ROCm 10 รอบอุ่น 19-21 ต.ค. 2026  Flux 3 แก้ภาพ 1 รูป ~42 วิ, รวม 2 รูป ~152 วิ (รวมโหลดโมเดล)  Moss 1024x1024: 51 วิ")
save(fig, "10-image-models.png")
print("ok10")
