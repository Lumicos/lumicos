"""Which pack is cheaper per litre / kilo / piece (claude-20261024)."""

_UNITS = {
    "ml": ("ml", 1.0), "มล": ("ml", 1.0), "มล.": ("ml", 1.0), "cc": ("ml", 1.0), "ซีซี": ("ml", 1.0),
    "l": ("ml", 1000.0), "ลิตร": ("ml", 1000.0), "liter": ("ml", 1000.0), "litre": ("ml", 1000.0),
    "g": ("g", 1.0), "กรัม": ("g", 1.0), "ขีด": ("g", 100.0),
    "kg": ("g", 1000.0), "กก": ("g", 1000.0), "กก.": ("g", 1000.0), "กิโล": ("g", 1000.0), "กิโลกรัม": ("g", 1000.0),
    "oz": ("g", 28.3495), "lb": ("g", 453.592),
}
_COUNT = {"ชิ้น", "อัน", "ขวด", "กระป๋อง", "ซอง", "ห่อ", "ถุง", "กล่อง", "ฟอง", "ม้วน", "แผ่น", "เม็ด", "ใบ", "ลูก", "แท่ง", "คู่", "pcs", "piece", "pack"}
_LABEL = {"ml": ("ลิตร", 1000.0), "g": ("กก.", 1000.0), "ชิ้น": ("ชิ้น", 1.0)}


def _unit(unit):
    u = str(unit).strip().lower()
    if u in _UNITS:
        return _UNITS[u]
    if u in _COUNT:
        return ("ชิ้น", 1.0)
    raise ValueError(f"ไม่รู้จักหน่วย {unit!r} (ใช้ ml, ลิตร, กรัม, กก., ขีด, ชิ้น/ขวด/ซอง/ฟอง ...)")


def _num(x, name):
    if isinstance(x, str):
        x = x.replace(",", "").strip()
    try:
        v = float(x)
    except (TypeError, ValueError):
        raise ValueError(f"{name} ต้องเป็นตัวเลข (ได้ {x!r})")
    if v <= 0:
        raise ValueError(f"{name} ต้องมากกว่า 0")
    return v


def per_unit(price, size, unit, count=1):
    """ราคาต่อลิตร/กก./ชิ้น: per_unit(39, 700, "ml") -> 55.71 บาท/ลิตร; แพ็ค 6 ขวด ขวดละ 330 มล. = per_unit(99, 330, "ml", count=6)"""
    price, size, count = _num(price, "price"), _num(size, "size"), _num(count, "count")
    base, factor = _unit(unit)
    total = size * factor * count
    label, per = _LABEL[base]
    return {"price": price, "total": round(total, 3), "base_unit": base, "per": label, "price_per": round(price / total * per, 2)}


def compare_prices(*options):
    """เทียบความคุ้ม: แต่ละตัวเลือกเป็น (ชื่อ, ราคา, ขนาด, หน่วย) หรือ (ชื่อ, ราคา, ขนาด, หน่วย, จำนวนชิ้นในแพ็ค)
    compare_prices(("ขวดใหญ่", 25, 2, "ลิตร"), ("แพ็ค 6", 72, 500, "ml", 6))"""
    if len(options) < 2:
        raise ValueError("ต้องมีอย่างน้อย 2 ตัวเลือก")
    rows = []
    for o in options:
        name, price, size, unit, *rest = o
        r = per_unit(price, size, unit, rest[0] if rest else 1)
        r["name"] = str(name)
        rows.append(r)
    if len({r["base_unit"] for r in rows}) > 1:
        raise ValueError("เทียบได้เฉพาะหน่วยประเภทเดียวกัน (ปริมาตรกับปริมาตร น้ำหนักกับน้ำหนัก ชิ้นกับชิ้น)")
    best = min(rows, key=lambda r: r["price"] / r["total"])
    for r in rows:
        r["more_than_cheapest_percent"] = round((r["price"] / r["total"]) / (best["price"] / best["total"]) * 100 - 100, 1)
    return {"cheapest": best["name"], "per": best["per"], "options": rows}
