import type { ToolRun } from '../types';

// Checks on a finished draft that earn it one more try (claude-20261023, Real Chat Check):
// Gemma said "เดี๋ยวลองรันใหม่ให้ค่ะ" after a failed run_python call and stopped; Lumicos answered a VAT question without
// running the matched skill and wrote "ฉันใช้เครื่องมือคำนวณให้แล้ว" although no tool had run.

// Python source writes Windows paths as "skills\\x\\script.py": any run of backslashes is one separator.
const codeOf = (r: ToolRun) => String(r.args?.code ?? '').replace(/\\+/g, '/').replace(/(^|[("'\s])\.\//g, '$1');

/** The last run_python call of this reply failed (the Python code raised or exited non-zero). */
export function lastRunFailed(runs: ToolRun[] | undefined): boolean {
  const last = [...(runs ?? [])].reverse().find((r) => r.tool === 'run_python');
  if (!last) return false;
  if (last.status === 'error') return true;
  const code = (last.data as { exitCode?: unknown } | undefined)?.exitCode;
  if (typeof code === 'number') return code !== 0;
  return /^exit_code:\s*[1-9]/.test(last.resultForModel ?? '');
}

/** This reply ran the skill's script with run_python (paths with ./ or backslashes count too). */
export function ranScript(runs: ToolRun[] | undefined, script: string): boolean {
  const want = script.replace(/\\/g, '/').replace(/^\.\//, '');
  return (runs ?? []).some((r) => r.tool === 'run_python' && codeOf(r).includes(want));
}

/** The reply says a tool, skill or script was used ("ฉันใช้เครื่องมือคำนวณให้แล้ว", "ใช้สกิลคำนวณให้เรียบร้อย"). */
export const CLAIMS_TOOL = /((?:ฉัน|ดิฉัน|เรา|ผม|หนู)\s*(?:ได้)?(?:ลอง)?(?:ใช้|รัน|เรียก)(?:ใช้)?\s*(?:เครื่องมือ|สกิล|สคริปต์|โปรแกรม|โค้ด|python|run_python)|(?:ใช้|รัน|เรียก)\s*(?:เครื่องมือ|สกิล|สคริปต์|โค้ด|python|run_python)\S{0,20}ให้\s*(?:แล้ว|เรียบร้อย)|\bI (?:ran|used|called) (?:the |a )?(?:tool|script|skill|python)\b)/iu;

export const RETRY_NOTES = {
  failed: 'Your last run_python call failed. Read the error above, fix the call as it says, and run it again now: reply with only the ```tool block.',
  notRun: (script: string) => `A saved skill matched this message, but its script was not run. If the request is that task, reply now with only a \`\`\`tool block calling run_python with exec(open("${script}", encoding="utf-8").read()) and print() of the right function with the user's own numbers. If it is not that task, answer normally and do not say you used a tool.`,
  claim: 'No tool ran in this reply, so do not say or imply that you used a tool, skill or script. Write the answer again without that claim.',
};
