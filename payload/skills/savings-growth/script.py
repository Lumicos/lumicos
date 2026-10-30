"""ออมเงินรายเดือน + ดอกเบี้ยทบต้นรายเดือน: ได้เท่าไหร่ ต้องออมเดือนละเท่าไหร่ และกี่เดือนถึงเป้า.
rate คือดอกเบี้ยต่อปีเป็นเปอร์เซ็นต์ (2 = 2% ต่อปี). เงินฝากเข้าทุกสิ้นเดือน."""


def _num(x):
    return float(str(x).replace(",", "").strip())


def _fv(initial, monthly, r, n):
    if r == 0:
        return initial + monthly * n
    g = (1 + r) ** n
    return initial * g + monthly * (g - 1) / r


def _months_text(n):
    y, m = divmod(int(n), 12)
    return " ".join(p for p in (f"{y} ปี" if y else "", f"{m} เดือน" if m else "") if p) or "0 เดือน"


def savings(monthly=0, years=0, rate=0, initial=0, months=None, tax=0):
    """เงินที่ได้: monthly = ออมเดือนละ, years หรือ months = ระยะเวลา, rate = % ต่อปี, initial = เงินก้อนแรก,
    tax = % ภาษีที่หักจากดอกเบี้ย (ฝากประจำทั่วไปมักหัก 15)."""
    monthly, initial, rate, tax = _num(monthly), _num(initial), _num(rate), _num(tax)
    n = int(months) if months is not None else round(_num(years) * 12)
    if min(monthly, initial, rate, tax) < 0 or n < 0:
        raise ValueError("ตัวเลขติดลบไม่ได้")
    deposited = initial + monthly * n
    gross = _fv(initial, monthly, rate / 100 / 12, n)
    interest = gross - deposited
    tax_amt = interest * tax / 100
    return {"months": n, "period": _months_text(n), "deposited": round(deposited, 2), "interest": round(interest, 2),
            "tax": round(tax_amt, 2), "final": round(gross - tax_amt, 2)}


def monthly_needed(goal, years, rate=0, initial=0):
    """ต้องออมเดือนละเท่าไหร่ให้ถึงเป้า goal ภายใน years ปี."""
    goal, rate, initial = _num(goal), _num(rate), _num(initial)
    n = round(_num(years) * 12)
    if n <= 0:
        raise ValueError("ระยะเวลาต้องมากกว่า 0")
    r = rate / 100 / 12
    rest = goal - (initial * (1 + r) ** n if r else initial)
    if rest <= 0:
        return {"monthly": 0.0, "months": n, "note": "เงินก้อนแรกโตถึงเป้าเองแล้ว ไม่ต้องออมเพิ่ม"}
    monthly = rest / n if r == 0 else rest * r / ((1 + r) ** n - 1)
    return {"monthly": round(monthly, 2), "months": n, "period": _months_text(n),
            "deposited": round(initial + monthly * n, 2), "interest": round(goal - initial - monthly * n, 2)}


def months_to_goal(goal, monthly, rate=0, initial=0):
    """ออมเดือนละ monthly ต้องใช้กี่เดือนถึงเป้า (นับเป็นเดือนเต็ม สูงสุด 100 ปี)."""
    goal, monthly, rate, initial = _num(goal), _num(monthly), _num(rate), _num(initial)
    if monthly <= 0 and initial < goal:
        raise ValueError("ต้องออมมากกว่า 0 ต่อเดือน")
    r = rate / 100 / 12
    for n in range(0, 1201):
        if _fv(initial, monthly, r, n) >= goal - 1e-9:
            final = _fv(initial, monthly, r, n)
            return {"months": n, "period": _months_text(n), "final": round(final, 2),
                    "deposited": round(initial + monthly * n, 2)}
    raise ValueError("เกิน 100 ปียังไม่ถึงเป้า")
