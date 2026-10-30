"""ค่าไฟของเครื่องใช้ไฟฟ้า: วัตต์ × ชั่วโมง → หน่วย (kWh) → บาท."""

DEFAULT_RATE = 4.5  # บาทต่อหน่วย (ค่าประมาณรวม Ft และ VAT) ใช้เมื่อผู้ใช้ไม่รู้อัตราจริงของตัวเอง


def _num(x):
    return float(str(x).replace(",", "").strip())


def appliance_cost(watts, hours_per_day=None, days=30, rate=DEFAULT_RATE, count=1, minutes_per_day=None):
    """watts = กำลังไฟ (วัตต์) ต่อเครื่อง, hours_per_day = ชั่วโมงที่เปิดต่อวัน หรือ minutes_per_day = นาทีต่อวัน
    (เช่น วันละ 30 นาที), days = จำนวนวันที่คิด (ค่าเริ่ม 30), rate = บาทต่อหน่วย, count = จำนวนเครื่อง."""
    if minutes_per_day is not None:
        hours_per_day = _num(minutes_per_day) / 60
    if hours_per_day is None:
        raise ValueError("ต้องบอกเวลาที่เปิดต่อวัน: hours_per_day=ชั่วโมง หรือ minutes_per_day=นาที")
    watts, hours, days, rate, count = _num(watts), _num(hours_per_day), _num(days), _num(rate), int(count)
    if watts < 0 or hours < 0 or days < 0 or rate < 0 or count < 1:
        raise ValueError("ตัวเลขติดลบไม่ได้ และต้องมีอย่างน้อย 1 เครื่อง")
    if hours > 24:
        raise ValueError("เปิดได้ไม่เกิน 24 ชั่วโมงต่อวัน - ถ้าผู้ใช้บอกเป็นนาที ให้ใช้ minutes_per_day= แทน (วันละ 30 นาที → minutes_per_day=30)")
    kwh_day = watts * count * hours / 1000
    return {"kwh_per_day": round(kwh_day, 3), "kwh_total": round(kwh_day * days, 2),
            "baht_per_day": round(kwh_day * rate, 2), "baht_total": round(kwh_day * days * rate, 2),
            "days": days, "rate": rate}


def aircon_watts(btu, seer=15.0):
    """ประมาณกำลังไฟเฉลี่ยของแอร์จาก BTU และค่า SEER บนฉลากประหยัดไฟ (ค่าเริ่ม 15 ≈ เบอร์ 5 ทั่วไป).
    เป็นค่าประมาณ: ถ้าฉลากบอกกำลังไฟ (วัตต์) ให้ใช้ตัวเลขนั้นแทน."""
    btu, seer = _num(btu), _num(seer)
    if btu <= 0 or seer <= 0:
        raise ValueError("BTU และ SEER ต้องมากกว่า 0")
    return round(btu / seer)


def bill_rate(amount, units):
    """อัตราจริงต่อหน่วยจากบิลค่าไฟของผู้ใช้: ยอดเงินทั้งบิล ÷ จำนวนหน่วยที่ใช้."""
    amount, units = _num(amount), _num(units)
    if units <= 0:
        raise ValueError("จำนวนหน่วยต้องมากกว่า 0")
    return round(amount / units, 2)


def label_cost(kwh_per_year, rate=DEFAULT_RATE):
    """จากฉลากประหยัดไฟที่บอก "หน่วยต่อปี" (เช่น ตู้เย็น): ค่าไฟต่อปีและต่อเดือน."""
    kwh, rate = _num(kwh_per_year), _num(rate)
    if kwh < 0 or rate < 0:
        raise ValueError("ตัวเลขติดลบไม่ได้")
    return {"baht_per_year": round(kwh * rate, 2), "baht_per_month": round(kwh * rate / 12, 2), "rate": rate}
