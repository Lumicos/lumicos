import csv

def summarize_csv(path):
    with open(path, mode='r', encoding='utf-8', newline='') as f:
        reader = csv.reader(f)
        headers = next(reader, [])
        rows = []
        for row in reader:
            if row:
                rows.append(row)
    
    num_rows = len(rows)
    num_cols = len(headers)
    numeric_stats = {}
    
    for i, col_name in enumerate(headers):
        values = []
        is_numeric_col = True
        for row in rows:
            if i < len(row) and row[i].strip():
                try:
                    values.append(float(row[i]))
                except ValueError:
                    is_numeric_col = False
                    break
        
        if is_numeric_col and values:
            numeric_stats[col_name] = {
                "min": round(min(values), 2),
                "max": round(max(values), 2),
                "mean": round(sum(values) / len(values), 2)
            }
            
    return {
        "rows": num_rows,
        "columns": headers,
        "numeric": numeric_stats
    }
