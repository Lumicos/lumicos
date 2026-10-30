"""Fuel (or charging) cost of a trip from distance, consumption and price (claude-20261024)."""


def _num(x, name, allow_zero=False):
    if isinstance(x, str):
        x = x.replace(",", "").strip()
    try:
        v = float(x)
    except (TypeError, ValueError):
        raise ValueError(f"{name} ต้องเป็นตัวเลข (ได้ {x!r})")
    if v < 0 or (v == 0 and not allow_zero):
        raise ValueError(f"{name} ต้องมากกว่า 0")
    return v


def trip_cost(distance_km, price_per_liter, km_per_liter=None, liters_per_100km=None, round_trip=False, people=1):
    """ค่าน้ำมัน: trip_cost(450, 40, km_per_liter=12) -> 37.5 ลิตร 1,500 บาท
    อัตรากินน้ำมันแบบ ลิตร/100 กม. ใส่ liters_per_100km=; ไป-กลับ round_trip=True; หารกัน people="""
    d = _num(distance_km, "distance_km") * (2 if round_trip else 1)
    price = _num(price_per_liter, "price_per_liter")
    if km_per_liter is not None:
        liters = d / _num(km_per_liter, "km_per_liter")
    elif liters_per_100km is not None:
        liters = d * _num(liters_per_100km, "liters_per_100km") / 100
    else:
        raise ValueError("ต้องบอกอัตรากินน้ำมัน: km_per_liter= (กม./ลิตร) หรือ liters_per_100km= (ลิตร/100 กม.)")
    n = int(_num(people, "people"))
    cost = liters * price
    return {"distance_km": round(d, 1), "liters": round(liters, 2), "cost": round(cost, 2),
            "per_person": round(cost / n, 2) if n > 1 else None, "people": n}


def ev_trip_cost(distance_km, price_per_kwh, kwh_per_100km=15, round_trip=False, people=1):
    """ค่าไฟรถไฟฟ้า: ev_trip_cost(300, 7.5, kwh_per_100km=16) -> 48 kWh 360 บาท"""
    d = _num(distance_km, "distance_km") * (2 if round_trip else 1)
    kwh = d * _num(kwh_per_100km, "kwh_per_100km") / 100
    n = int(_num(people, "people"))
    cost = kwh * _num(price_per_kwh, "price_per_kwh")
    return {"distance_km": round(d, 1), "kwh": round(kwh, 2), "cost": round(cost, 2),
            "per_person": round(cost / n, 2) if n > 1 else None, "people": n}
