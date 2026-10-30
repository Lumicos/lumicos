import math

def calculate_installment(P, annual_rate, n):
    # P: Principal Amount (เงินต้น)
    # annual_rate: Annual Interest Rate (เช่น 0.04 สำหรับ 4%)
    # n: Number of periods (จำนวนงวด)
    
    # 1. Calculate monthly interest rate (r)
    r = annual_rate / 12
    
    # 2. Calculate the installment (M) using the formula:
    # M = P * [ r * (1 + r)^n ] / [ (1 + r)^n - 1 ]
    
    # Calculate the factor (1 + r)^n
    power_factor = math.pow((1 + r), n)
    
    # Calculate M
    numerator = r * power_factor
    denominator = power_factor - 1
    
    if denominator == 0:
        return None, "Denominator is zero (should not happen if n > 0)"

    M = P * (numerator / denominator)
    
    return M, "Success"

# Example usage (based on previous conversation: P=800000, Annual Rate=0.04, n=48)
# M, status = calculate_installment(800000, 0.04, 48)
# print(f"Status: {status}")
# if M is not None:
#     print(f"Calculated Installment (M): {M:.2f}")