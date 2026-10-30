import { AlertTriangle, Ban, Check, ChevronRight, CircleSlash, Loader2, ShieldAlert, Wrench, X } from 'lucide-react';
import { useState } from 'react';
import type { ToolRun } from '../types';
import { useChatActions } from './chatActions';

function label(run: ToolRun) {
  if (run.status === 'done' && run.summary) return run.summary;
  if (run.status === 'denied') return run.summary ?? `Declined ${run.tool}`;
  const p = run.preview;
  const base = p ? `${p.action}${p.target ? ` ${p.target}` : ''}` : run.tool;
  if (run.status === 'error') return `${base} — failed`;
  if (run.status === 'cancelled') return `${base} — cancelled`;
  return base;
}

function StatusIcon({ run }: { run: ToolRun }) {
  switch (run.status) {
    case 'done':
      return <Check size={14} className="ok" />;
    case 'error':
      return <X size={14} className="bad" />;
    case 'denied':
      return <Ban size={14} className="muted" />;
    case 'cancelled':
      return <CircleSlash size={14} className="muted" />;
    case 'awaiting':
      return <ShieldAlert size={14} className="warn" />;
    default:
      return <Loader2 size={14} className="spin muted" />;
  }
}

/** Collapsible "Used tools" list + the confirmation card for a pending action. */
export function ToolActivity({ runs, live }: { runs: ToolRun[]; live: boolean }) {
  const { toolDebug, openFile } = useChatActions();
  const awaiting = runs.find((r) => r.status === 'awaiting');
  const [open, setOpen] = useState(false);
  const expanded = open || live;
  const failed = runs.filter((r) => r.status === 'error').length;

  return (
    <div className="tool-activity">
      <button className="tool-activity-head" onClick={() => setOpen((o) => !o)} aria-expanded={expanded}>
        <Wrench size={13} />
        <span>
          Used tools · {runs.length}
          {failed ? <span className="bad"> · {failed} failed</span> : null}
        </span>
        <ChevronRight size={14} className={`chev ${expanded ? 'open' : ''}`} />
      </button>
      {expanded && (
        <ul className="tool-list">
          {runs.map((r) => {
            const data = r.data as { path?: unknown; results?: {title:string;url:string}[] } | undefined;
            const candidate = data?.path ?? r.args.path;
            const path = typeof candidate === 'string' && /\.\w+$/.test(candidate) ? candidate : undefined;
            return (
              <li key={r.id} className={`tool-item st-${r.status}`}>
                <StatusIcon run={r} />
                <span className="tool-item-label">{label(r)}</span>
                {r.tool==='web_search'&&r.status==='done'&&Array.isArray(data?.results)&&<span className="web-sources">{data.results.filter(s=>/^https?:\/\//i.test(s.url)).map(s=><a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>)}</span>}
                {r.status === 'done' && path && r.tool !== 'delete_file' && (
                  <button className="link-btn" onClick={() => openFile(path)}>
                    Open
                  </button>
                )}
                {r.status === 'error' && r.error && <div className="tool-item-error">{r.error}</div>}
                {toolDebug && (
                  <pre className="tool-debug">
                    {JSON.stringify({ tool: r.tool, arguments: r.args, permission: r.permission }, null, 2)}
                    {r.resultForModel ? `\n\n— result sent to the model —\n${r.resultForModel}` : ''}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {awaiting && <ConfirmCard run={awaiting} />}
    </div>
  );
}

function ConfirmCard({ run }: { run: ToolRun }) {
  const { characterName, respondToTool } = useChatActions();
  const destructive = run.permission === 'destructive';
  const p = run.preview;
  return (
    <div className={`confirm-card ${destructive ? 'danger' : ''}`} role="alertdialog" aria-label="Confirm action">
      <div className="confirm-card-title">
        {destructive ? <AlertTriangle size={16} /> : <ShieldAlert size={16} />}
        <span>
          {characterName} wants to {destructive ? <b className="danger-text">{p?.action ?? run.tool}</b> : (p?.action ?? run.tool).toLowerCase()}:
        </span>
      </div>
      {p?.target && <div className="confirm-card-target">{p.target}</div>}
      {p?.details && (
        <div className="confirm-card-section">
          <div className="confirm-card-label">Details</div>
          <pre>{p.details}</pre>
        </div>
      )}
      {p?.warning && <div className="confirm-card-warning">{p.warning}</div>}
      <div className="confirm-card-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => respondToTool(run.id, false)}>
          Cancel
        </button>
        <button className={`btn btn-sm ${destructive ? 'btn-danger' : 'btn-primary'}`} onClick={() => respondToTool(run.id, true)} autoFocus>
          {destructive ? `Yes, ${(p?.action ?? 'continue').toLowerCase()}` : 'Allow once'}
        </button>
      </div>
    </div>
  );
}
