"""Everyday percent maths. claude-20261024: without a skill Gemma wrote print(17.5 * 2340) for "17.5% ของ 2,340"."""


def _num(x, name):
    if isinstance(x, str):
        x = x.replace(",", "").replace("%", "").strip()
    try:
        return float(x)
    except (TypeError, ValueError):
        raise ValueError(f"{name} ต้องเป็นตัวเลข (ได้ {x!r})")


def _r(x):
    return round(float(x) + 0.0, 2)


def percent_of(percent, amount):
    """X% ของ Y: percent_of(12.5, 840) -> result 105.0 (ใส่ 12.5 ไม่ใช่ 0.125)"""
    p, a = _num(percent, "percent"), _num(amount, "amount")
    return {"percent": p, "amount": a, "result": _r(a * p / 100)}


def what_percent(part, whole):
    """part คิดเป็นกี่ % ของ whole: what_percent(45, 180) -> 25.0"""
    part, whole = _num(part, "part"), _num(whole, "whole")
    if whole == 0:
        raise ValueError("whole (ตัวหาร) ต้องไม่เป็น 0")
    return {"part": part, "whole": whole, "percent": _r(part / whole * 100)}


def percent_change(old, new):
    """จาก old เป็น new เปลี่ยนไปกี่ % (บวก = เพิ่มขึ้น, ลบ = ลดลง): percent_change(80, 92) -> 15.0"""
    old, new = _num(old, "old"), _num(new, "new")
    if old == 0:
        raise ValueError("ค่าเดิม (old) ต้องไม่เป็น 0")
    change = new - old
    direction = "เพิ่มขึ้น" if change > 0 else "ลดลง" if change < 0 else "เท่าเดิม"
    return {"old": old, "new": new, "change": _r(change), "percent": _r(change / abs(old) * 100), "direction": direction}


def add_percent(amount, percent):
    """บวกเพิ่ม X% (ขึ้นราคา, บวกอีก): add_percent(1200, 8) -> 1296.0; ลด X% ใส่ percent ติดลบ"""
    a, p = _num(amount, "amount"), _num(percent, "percent")
    diff = a * p / 100
    return {"amount": a, "percent": p, "difference": _r(diff), "result": _r(a + diff)}


def before_percent(result, percent):
    """ย้อนหาค่าเดิม: หลังเพิ่ม X% ได้ result -> before_percent(550, 10) = 500.0; ถ้าลดมา ใส่ percent ติดลบ"""
    r, p = _num(result, "result"), _num(percent, "percent")
    if p <= -100:
        raise ValueError("percent ต้องมากกว่า -100")
    original = r / (1 + p / 100)
    return {"result": r, "percent": p, "original": _r(original), "difference": _r(r - original)}
