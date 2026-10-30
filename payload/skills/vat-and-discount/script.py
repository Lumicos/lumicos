def vat_calc(amount, rate=7.0, included=False):
    if amount < 0:
        raise ValueError("Amount cannot be negative")
    if included:
        net = amount / (1 + rate / 100)
        vat = amount - net
        total = amount
    else:
        net = amount
        vat = amount * (rate / 100)
        total = amount + vat
    return {
        "net": round(float(net), 2),
        "vat": round(float(vat), 2),
        "total": round(float(total), 2)
    }

def discount_price(price, percent):
    if price < 0:
        raise ValueError("Price cannot be negative")
    if not (0 <= percent <= 100):
        raise ValueError("Percent must be between 0 and 100")
    return round(float(price * (1 - percent / 100)), 2)
