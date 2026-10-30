def convert(value, from_unit, to_unit):
    units = {
        "km": ("length", 1000),
        "m": ("length", 1),
        "ft": ("length", 0.3048),
        "mi": ("length", 1609.344),
        "kg": ("mass", 1000),
        "g": ("mass", 1),
        "lb": ("mass", 453.59237),
        "oz": ("mass", 28.349523125),
        "l": ("volume", 1),
        "gal": ("volume", 3.785411784),
        "c": ("temp", 0),
        "f": ("temp", 0)
    }
    
    if from_unit not in units or to_unit not in units:
        raise ValueError("Unknown unit")
    
    f_type, f_factor = units[from_unit]
    t_type, t_factor = units[to_unit]
    
    if f_type != t_type:
        raise ValueError("Incompatible units")
    
    if f_type == "temp":
        if from_unit == "c" and to_unit == "f":
            return round((value * 9/5) + 32, 4)
        if from_unit == "f" and to_unit == "c":
            return round((value - 32) * 5/9, 4)
        return round(float(value), 4)
    
    base_val = value * f_factor
    return round(base_val / t_factor, 4)
