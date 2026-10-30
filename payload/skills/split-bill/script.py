"""หารค่าอาหาร/ค่าใช้จ่ายร่วมกัน แบบไทย: เซอร์วิสชาร์จคิดจากค่าอาหาร แล้ว VAT คิดจาก (ค่าอาหาร + เซอร์วิสชาร์จ)."""
from decimal import Decimal, ROUND_HALF_UP, ROUND_CEILING

_C = Decimal("0.01")


def _d(x):
    return Decimal(str(x).replace(",", "").strip())


def _baht(x):
    return float(x.quantize(_C, rounding=ROUND_HALF_UP))


def _bill(subtotal, service, vat):
    service_amt = (subtotal * _d(service) / 100).quantize(_C, rounding=ROUND_HALF_UP)
    vat_amt = ((subtotal + service_amt) * _d(vat) / 100).quantize(_C, rounding=ROUND_HALF_UP)
    return service_amt, vat_amt


def _shares(total, n):
    """แบ่ง total เป็น n ส่วนให้รวมกันได้ตรงทุกสตางค์ (เศษสตางค์ไปอยู่ที่คนแรก ๆ)."""
    cents = int((total * 100).to_integral_value(rounding=ROUND_HALF_UP))
    base, extra = divmod(cents, n)
    return [float(Decimal(base + (1 if i < extra else 0)) / 100) for i in range(n)]


def split_bill(total, people, service=0, vat=0, tip=0, round_up_to=None):
    """หารเท่ากัน.
    total = ค่าอาหารก่อนเซอร์วิส/VAT, people = จำนวนคน, service/vat = เปอร์เซ็นต์ (เช่น 10, 7), tip = ทิปเป็นบาท,
    round_up_to = ปัดยอดต่อคนขึ้นให้ลงตัว เช่น 10 หรือ 20 (เงินที่เกินบอกไว้ใน extra)."""
    people = int(people)
    if people < 1:
        raise ValueError("จำนวนคนต้องมีอย่างน้อย 1")
    subtotal = _d(total)
    if subtotal < 0:
        raise ValueError("ยอดเงินติดลบไม่ได้")
    service_amt, vat_amt = _bill(subtotal, service, vat)
    grand = subtotal + service_amt + vat_amt + _d(tip)
    shares = _shares(grand, people)
    out = {"subtotal": _baht(subtotal), "service": _baht(service_amt), "vat": _baht(vat_amt), "tip": _baht(_d(tip)),
           "grand_total": _baht(grand), "per_person": _baht(grand / people), "shares": shares}
    if round_up_to:
        step = _d(round_up_to)
        each = ((grand / people) / step).to_integral_value(rounding=ROUND_CEILING) * step
        out["per_person_rounded"] = _baht(each)
        out["extra"] = _baht(each * people - grand)
    return out


def split_items(items, shared=0, service=0, vat=0):
    """จ่ายตามที่สั่งเอง + หารของกลางเท่ากัน.
    items = {"ชื่อ": ยอดที่สั่งเอง, ...}, shared = ยอดของกินร่วมกัน (หารเท่ากันทุกคน),
    เซอร์วิส/VAT เฉลี่ยตามสัดส่วนยอดของแต่ละคน. คืน {"ชื่อ": ยอดที่ต้องจ่าย, ..., "รวม": ยอดทั้งบิล}."""
    if not items:
        raise ValueError("ต้องมีอย่างน้อย 1 คน")
    names = list(items)
    shared_each = _d(shared) / len(names)
    own = {n: _d(items[n]) + shared_each for n in names}
    subtotal = sum(own.values())
    service_amt, vat_amt = _bill(subtotal, service, vat)
    grand = subtotal + service_amt + vat_amt
    # ยอดของแต่ละคนตามสัดส่วน แล้วให้คนสุดท้ายรับเศษสตางค์ เพื่อให้รวมกันตรงยอดบิล
    result, running = {}, Decimal(0)
    for i, n in enumerate(names):
        if i == len(names) - 1:
            amt = grand - running
        else:
            amt = (grand * own[n] / subtotal).quantize(_C, rounding=ROUND_HALF_UP) if subtotal else Decimal(0)
            running += amt
        result[n] = _baht(amt)
    result["รวม"] = _baht(grand)
    return result
