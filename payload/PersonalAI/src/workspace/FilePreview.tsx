import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Markdown } from '../chat/Markdown';
import { localService, type DocBlock, type FilePreview as Preview } from '../services/localService';
import { fmtBytes, fmtDateTime, TYPE_NAME } from './format';

/** Read-only preview for inspection & confirmation (not an editor). */
export function FilePreview({ path, onClose, onDownload }: { path: string; onClose: () => void; onDownload: () => void }) {
  const [data, setData] = useState<Preview>();
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setError(undefined);
    setSheet(0);
    localService.files
      .preview(path)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <aside className="preview-pane">
      <header className="preview-pane-head">
        <div className="preview-pane-title">
          <div className="preview-pane-name">{path.split('/').pop()}</div>
          {data && (
            <div className="muted small">
              {TYPE_NAME[data.stat.type] ?? data.stat.type} · {fmtBytes(data.stat.size)} · modified {fmtDateTime(data.stat.modified)}
            </div>
          )}
        </div>
        <button className="icon-btn" onClick={onDownload} title="Download">
          <Download size={16} />
        </button>
        <button className="icon-btn" onClick={onClose} title="Close preview">
          <X size={16} />
        </button>
      </header>
      <div className="preview-pane-body">
        {error && <div className="form-error">{error}</div>}
        {!data && !error && <div className="muted small">Loading…</div>}
        {data && <Body data={data} sheet={sheet} setSheet={setSheet} />}
      </div>
      {data && <div className="preview-pane-foot muted small">workspace/{data.stat.path}</div>}
    </aside>
  );
}

function Body({ data, sheet, setSheet }: { data: Preview; sheet: number; setSheet: (i: number) => void }) {
  switch (data.kind) {
    case 'markdown':
      return <Markdown text={data.text ?? ''} />;
    case 'csv':
      return <Grid rows={data.rows ?? []} header />;
    case 'json':
    case 'text':
      return <pre className="preview-raw">{data.text}</pre>;
    case 'docx':
      return (
        <div className="doc-preview">
          {(data.blocks ?? []).map((b, i) => (
            <DocBlockView key={i} block={b} />
          ))}
          {!data.blocks?.length && <div className="muted small">This document has no text.</div>}
        </div>
      );
    case 'xlsx': {
      const sheets = data.workbook?.sheets ?? [];
      const s = sheets[sheet];
      return (
        <div className="xlsx-preview">
          <div className="sheet-tabs">
            {sheets.map((x, i) => (
              <button key={x.name} className={i === sheet ? 'active' : ''} onClick={() => setSheet(i)}>
                {x.name}
              </button>
            ))}
          </div>
          {s ? (
            <>
              <div className="muted small">
                {s.rowCount} rows × {s.columnCount} columns{s.truncated ? ' · first rows shown' : ''}
              </div>
              <Grid rows={s.rows.map((r) => r.map((c) => (c.f && c.v === '' ? c.f : String(c.v)))) } formulas={s.rows.map((r) => r.map((c) => c.f))} letters />
            </>
          ) : (
            <div className="muted small">Empty workbook.</div>
          )}
        </div>
      );
    }
    default:
      return <div className="muted small">No preview for this file type. You can download it.</div>;
  }
}

const colLetter = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

function Grid({ rows, header, letters, formulas }: { rows: (string | number)[][]; header?: boolean; letters?: boolean; formulas?: (string | undefined)[][] }) {
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (!rows.length) return <div className="muted small">Empty.</div>;
  return (
    <div className="grid-wrap">
      <table className="grid">
        {letters && (
          <thead>
            <tr>
              <th className="grid-corner" />
              {Array.from({ length: width }, (_, i) => (
                <th key={i}>{colLetter(i)}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className={header && ri === 0 ? 'grid-head' : undefined}>
              {letters && <th className="grid-rownum">{ri + 1}</th>}
              {Array.from({ length: width }, (_, ci) => (
                <td key={ci} title={formulas?.[ri]?.[ci] ?? undefined} className={formulas?.[ri]?.[ci] ? 'has-formula' : undefined}>
                  {String(r[ci] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocBlockView({ block: b }: { block: DocBlock }) {
  switch (b.type) {
    case 'title':
      return <h1>{b.text}</h1>;
    case 'heading': {
      const H = (`h${Math.min(6, b.level + 1)}` as unknown) as 'h2';
      return <H>{b.text}</H>;
    }
    case 'bullets':
      return (
        <ul>
          {b.items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      );
    case 'numbered':
      return (
        <ol>
          {b.items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ol>
      );
    case 'table':
      return <Grid rows={b.rows} header />;
    default:
      return <p>{b.text}</p>;
  }
}
