import {
  ArrowLeft,
  ChevronRight,
  Copy,
  Download,
  File,
  FileJson,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  HardDrive,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ServiceOffline } from '../memory/MemoryPage';
import { ConfirmDialog } from '../components/Modal';
import { PromptDialog } from '../components/PromptDialog';
import { localService, type FileEntry } from '../services/localService';
import { FilePreview } from './FilePreview';
import { fmtBytes, fmtDateTime, saveBlob, TYPE_NAME } from './format';

interface Props {
  online: boolean;
  workspaceRoot?: string;
  /** A file to show when the page opens (e.g. "Open" from a tool result). */
  focusPath?: string;
  onBack: () => void;
}

type Dialog =
  | { kind: 'mkdir' }
  | { kind: 'rename'; entry: FileEntry }
  | { kind: 'move'; entry: FileEntry }
  | { kind: 'copy'; entry: FileEntry }
  | { kind: 'delete'; entry: FileEntry }
  | null;

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

function Icon({ type }: { type: FileEntry['type'] }) {
  if (type === 'folder') return <Folder size={17} className="fi fi-folder" />;
  if (type === 'xlsx' || type === 'csv') return <FileSpreadsheet size={17} className="fi fi-sheet" />;
  if (type === 'docx') return <FileText size={17} className="fi fi-doc" />;
  if (type === 'json') return <FileJson size={17} className="fi" />;
  if (type === 'markdown' || type === 'text') return <FileText size={17} className="fi" />;
  return <File size={17} className="fi" />;
}

export function WorkspacePage({ online, workspaceRoot, focusPath, onBack }: Props) {
  const [dir, setDir] = useState(focusPath ? parentOf(focusPath) : '');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string | undefined>(focusPath);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [dialog, setDialog] = useState<Dialog>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusPath) {
      setDir(parentOf(focusPath));
      setSelected(focusPath);
    }
  }, [focusPath]);

  const load = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    setError(undefined);
    try {
      setEntries((await localService.files.list(dir)).entries);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [dir, online]);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(undefined), 3500);
  };

  const download = async (path: string) => {
    try {
      await saveBlob(await localService.files.download(path), path.split('/').pop() ?? 'file');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const upload = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      try {
        const r = await localService.files.upload(dir ? `${dir}/${f.name}` : f.name, f);
        flash(r.renamed ? `Uploaded as ${r.path} (the name was taken)` : `Uploaded ${r.path}`);
      } catch (e) {
        setError((e as Error).message);
      }
    }
    load();
  };

  const crumbs = dir ? dir.split('/') : [];

  return (
    <main className="page page-workspace">
      <header className="page-header">
        <button className="icon-btn" onClick={onBack} title="Back to chat">
          <ArrowLeft size={18} />
        </button>
        <div className="page-title">
          <h1>
            <HardDrive size={20} /> Workspace
          </h1>
          <p>{workspaceRoot ? <code>{workspaceRoot}</code> : 'The folder PersonalAI may read and write.'} Your AI can only access files in here.</p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={load} title="Refresh" disabled={!online}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
          <button className="btn btn-ghost" onClick={() => setDialog({ kind: 'mkdir' })} disabled={!online}>
            <FolderPlus size={15} /> New folder
          </button>
          <button className="btn btn-primary" onClick={() => uploadRef.current?.click()} disabled={!online}>
            <Upload size={15} /> Upload
          </button>
          <input ref={uploadRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        </div>
      </header>

      {!online ? (
        <ServiceOffline what="The workspace" />
      ) : (
        <div className={`ws-layout ${selected ? 'with-preview' : ''}`}>
          <section className="ws-main" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
            <nav className="crumbs">
              <button onClick={() => setDir('')} className={!dir ? 'current' : ''}>
                workspace
              </button>
              {crumbs.map((c, i) => (
                <span key={i} className="crumb">
                  <ChevronRight size={13} />
                  <button className={i === crumbs.length - 1 ? 'current' : ''} onClick={() => setDir(crumbs.slice(0, i + 1).join('/'))}>
                    {c}
                  </button>
                </span>
              ))}
            </nav>
            {notice && <div className="notice">{notice}</div>}
            {error && <div className="form-error">{error}</div>}

            <div className="file-table" role="table">
              <div className="file-row file-head" role="row">
                <span>Name</span>
                <span>Type</span>
                <span className="num">Size</span>
                <span>Modified</span>
                <span />
              </div>
              {dir && (
                <button className="file-row" onClick={() => setDir(parentOf(dir))}>
                  <span className="file-name">
                    <Folder size={17} className="fi fi-folder" /> ..
                  </span>
                  <span />
                  <span />
                  <span />
                  <span />
                </button>
              )}
              {entries.map((e) => (
                <div
                  key={e.path}
                  role="row"
                  className={`file-row ${selected === e.path ? 'selected' : ''}`}
                  onClick={() => (e.type === 'folder' ? setDir(e.path) : setSelected(e.path))}
                  onDoubleClick={() => e.type !== 'folder' && download(e.path)}
                >
                  <span className="file-name" title={e.name}>
                    <Icon type={e.type} /> <span>{e.name}</span>
                  </span>
                  <span className="muted">{TYPE_NAME[e.type] ?? e.type}</span>
                  <span className="num muted">{e.type === 'folder' ? '' : fmtBytes(e.size)}</span>
                  <span className="muted">{fmtDateTime(e.modified)}</span>
                  <span className="file-actions" onClick={(ev) => ev.stopPropagation()}>
                    {e.type !== 'folder' && (
                      <button className="mini-btn" title="Download" onClick={() => download(e.path)}>
                        <Download size={14} />
                      </button>
                    )}
                    <button className="mini-btn" title="Rename" onClick={() => setDialog({ kind: 'rename', entry: e })}>
                      <Pencil size={14} />
                    </button>
                    <button className="mini-btn" title="Move" onClick={() => setDialog({ kind: 'move', entry: e })}>
                      <FolderInput size={14} />
                    </button>
                    <button className="mini-btn" title="Copy" onClick={() => setDialog({ kind: 'copy', entry: e })}>
                      <Copy size={14} />
                    </button>
                    <button className="mini-btn danger" title="Delete" onClick={() => setDialog({ kind: 'delete', entry: e })}>
                      <Trash2 size={14} />
                    </button>
                  </span>
                </div>
              ))}
              {!entries.length && !loading && <div className="file-empty">This folder is empty. Drop files here or use Upload.</div>}
            </div>
          </section>

          {selected && <FilePreview path={selected} onClose={() => setSelected(undefined)} onDownload={() => download(selected)} />}
        </div>
      )}

      {dialog?.kind === 'mkdir' && (
        <PromptDialog
          title="New folder"
          label="Folder name"
          confirmLabel="Create"
          onSubmit={async (v) => {
            await localService.files.mkdir(dir ? `${dir}/${v}` : v);
            load();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title={`Rename ${dialog.entry.name}`}
          label="New name"
          initial={dialog.entry.name}
          confirmLabel="Rename"
          onSubmit={async (v) => {
            const r = await localService.files.rename(dialog.entry.path, v);
            if (selected === dialog.entry.path) setSelected(r.path);
            load();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog?.kind === 'move' || dialog?.kind === 'copy') && (
        <PromptDialog
          title={`${dialog.kind === 'move' ? 'Move' : 'Copy'} ${dialog.entry.name}`}
          label="Destination folder (inside the workspace)"
          initial={dir}
          hint={<>For example <code>documents</code> or <code>notes/archive</code>. Use an empty value for the workspace root.</>}
          confirmLabel={dialog.kind === 'move' ? 'Move' : 'Copy'}
          onSubmit={async (v) => {
            const target = v.replace(/^workspace[\\/]?/, '');
            const r = dialog.kind === 'move' ? await localService.files.move(dialog.entry.path, target) : await localService.files.copy(dialog.entry.path, target);
            flash(`${dialog.kind === 'move' ? 'Moved' : 'Copied'} to ${r.path}`);
            if (dialog.kind === 'move' && selected === dialog.entry.path) setSelected(undefined);
            load();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete ${dialog.entry.name}?`}
          message={
            <>
              {dialog.entry.type === 'folder' ? 'This folder and everything in it' : 'This file'} will be removed from the workspace. A backup copy
              is kept in <code>data/backups</code>.
            </>
          }
          onConfirm={async () => {
            try {
              await localService.files.remove(dialog.entry.path);
              if (selected?.startsWith(dialog.entry.path)) setSelected(undefined);
              flash(`Deleted ${dialog.entry.path}`);
            } catch (e) {
              setError((e as Error).message);
            }
            load();
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </main>
  );
}
