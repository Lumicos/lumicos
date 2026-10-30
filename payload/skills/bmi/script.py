"""BMI with the Asian cut-offs used in Thailand (claude-20261024)."""

_LEVELS = [(18.5, "น้ำหนักน้อยกว่าเกณฑ์"), (23.0, "ปกติ"), (25.0, "น้ำหนักเกิน"), (30.0, "อ้วนระดับ 1"), (float("inf"), "อ้วนระดับ 2")]


def bmi(weight_kg, height_cm):
    """bmi(58, 160) -> 22.66 ปกติ; ส่วนสูงใส่เป็นซม. (ถ้าใส่เป็นเมตร เช่น 1.6 ก็ได้)"""
    w = float(str(weight_kg).replace(",", ""))
    h = float(str(height_cm).replace(",", ""))
    if w <= 0 or h <= 0:
        raise ValueError("น้ำหนักและส่วนสูงต้องมากกว่า 0")
    m = h if h < 3 else h / 100
    value = w / (m * m)
    level = next(name for limit, name in _LEVELS if value < limit)
    return {"bmi": round(value, 2), "level": level, "height_m": round(m, 3), "weight_kg": w,
            "normal_weight_kg": [round(18.5 * m * m, 1), round(22.9 * m * m, 1)],
            "note": "เกณฑ์คนเอเชีย: ต่ำกว่า 18.5 น้อย, 18.5–22.9 ปกติ, 23–24.9 เกิน, 25–29.9 อ้วนระดับ 1, 30 ขึ้นไป อ้วนระดับ 2"}
