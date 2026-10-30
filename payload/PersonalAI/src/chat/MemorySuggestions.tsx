import { Bookmark, Check, ChevronRight, Database, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { TYPE_LABEL } from '../memory/labels';
import { MEMORY_TYPES, type ContextInfo, type MemoryCandidate, type MemoryType, type UsedMemory } from '../types';
import { useChatActions } from './chatActions';



/** "Memory suggestion: … [Save] [Edit] [Ignore]" — nothing is stored until Save. */
export function MemorySuggestions({ messageId, candidates }: { messageId: string; candidates: MemoryCandidate[] }) {
  const visible = candidates.filter((c) => c.status !== 'ignored');
  if (!visible.length) return null;
  return (
    <div className="mem-suggest">
      {visible.map((c) => (
        <Suggestion key={c.id} messageId={messageId} candidate={c} />
      ))}
    </div>
  );
}

function Suggestion({ messageId, candidate }: { messageId: string; candidate: MemoryCandidate }) {
  const { saveCandidate, ignoreCandidate, openMemory, characterName, serviceOnline } = useChatActions();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(candidate.content);
  const [type, setType] = useState<MemoryType>(candidate.type);
  const [characterOnly, setCharacterOnly] = useState(candidate.type === 'relationship');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (candidate.status === 'saved') {
    return (
      <div className="mem-suggest-item saved">
        <Check size={14} className="ok" />
        <span className="mem-suggest-text">{candidate.content}</span>
        <button className="link-btn" onClick={openMemory}>
          Saved to memory
        </button>
      </div>
    );
  }

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await saveCandidate(messageId, { ...candidate, content: content.trim(), type }, characterOnly);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mem-suggest-item">
      <div className="mem-suggest-head">
        <Bookmark size={14} />
        <span>Memory suggestion</span>
        <span className="badge">{TYPE_LABEL[type]}</span>
        {candidate.source === 'model' && <span className="muted small">from {characterName}</span>}
      </div>
      {editing ? (
        <div className="mem-suggest-edit">
          <textarea rows={2} value={content} onChange={(e) => setContent(e.target.value)} autoFocus />
          <div className="mem-suggest-edit-row">
            <select value={type} onChange={(e) => setType(e.target.value as MemoryType)}>
              {MEMORY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <label className="check">
              <input type="checkbox" checked={characterOnly} onChange={(e) => setCharacterOnly(e.target.checked)} />
              Only for {characterName}
            </label>
          </div>
        </div>
      ) : (
        <div className="mem-suggest-text">“{candidate.content}”</div>
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="mem-suggest-actions">
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !content.trim() || !serviceOnline} title={serviceOnline ? '' : 'Local service is offline'}>
          <Check size={13} /> Save
        </button>
        {!editing && (
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            <Pencil size={13} /> Edit
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => ignoreCandidate(messageId, candidate.id)}>
          <X size={13} /> Ignore
        </button>
      </div>
    </div>
  );
}

/** Developer view: which memories were injected and how the context was built. */
export function MemoryDebug({ memories, info }: { memories?: UsedMemory[]; info?: ContextInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mem-debug">
      <button className="tool-activity-head" onClick={() => setOpen((o) => !o)}>
        <Database size={13} />
        <span>Memories used for this response · {memories?.length ?? 0}</span>
        <ChevronRight size={14} className={`chev ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="mem-debug-body">
          {memories?.length ? (
            <ul>
              {memories.map((m) => (
                <li key={m.id}>
                  <span className="badge">{TYPE_LABEL[m.type]}</span> {m.content}
                  <span className="muted small">
                    {' '}
                    · {m.reason === 'pinned' ? 'pinned' : `score ${m.score.toFixed(2)}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="muted small">No memories matched this message.</div>
          )}
          {info && (
            <div className="muted small">
              Sent {info.sentMessages} message(s){info.droppedMessages ? `, ${info.droppedMessages} older not sent (context limit)` : ''} · ~
              {info.estimatedTokens.toLocaleString()} tokens (estimate) · tools {info.toolsIncluded ? 'included' : 'not included'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
