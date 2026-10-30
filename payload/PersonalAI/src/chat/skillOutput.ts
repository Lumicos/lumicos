import type { ToolRun } from '../types';

/** Lines printed by this reply's run_python calls that ran `script` (failed runs are skipped). */
export function printedBySkill(runs: ToolRun[] | undefined, script: string): string[] {
  const lines: string[] = [];
  for (const run of runs ?? []) {
    if (run.tool !== 'run_python' || run.status !== 'done') continue;
    if (!String(run.args?.code ?? '').includes(script)) continue;
    const data = run.data as { stdout?: unknown; exitCode?: unknown } | undefined;
    if (data?.exitCode !== undefined && data.exitCode !== 0) continue;
    const stdout = typeof data?.stdout === 'string' ? data.stdout
      : /(?:^|\n)stdout:\n([\s\S]*?)(?:\n\n(?:stderr|created|changed|deleted):|$)/.exec(run.resultForModel ?? '')?.[1] ?? '';
    lines.push(...stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  }
  return lines;
}

/**
 * A skill whose printed result IS the answer ("output: exact", e.g. thai-baht-text): claude-20261023 Gemma retyped
 * "สี่พันเจ็ดร้อยห้าบาทยี่สิบห้าสตางค์" as "…ห้าสิบสองบาท…". If the reply lost any printed line, the printed lines are shown instead.
 */
export function keepExactOutput(reply: string, printed: string[]): string {
  if (!printed.length || printed.length > 10 || printed.join('\n').length > 1000) return reply;
  const flat = reply.replace(/\s+/g, '');
  return printed.every((line) => flat.includes(line.replace(/\s+/g, ''))) ? reply : printed.join('\n');
}
