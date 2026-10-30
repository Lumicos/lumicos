import { ArrowLeft, Brain, Check, MessageSquare, Pencil, Pin, PinOff, Plus, RefreshCw, Search, Star, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TYPE_LABEL } from './labels';
import { Avatar } from '../components/Avatar';
import { ConfirmDialog, Modal } from '../components/Modal';
import { getLang, tr } from '../i18n';
import { localService, type NewMemory } from '../services/localService';
import { MEMORY_TYPES, type Character, type Conversation, type Memory, type MemoryCandidate, type MemoryType } from '../types';

interface PendingSuggestion {
  conversation: Conversation;
  messageId: string;
  candidate: MemoryCandidate;
}

interface Props {
  online: boolean;
  dataDir?: string;
  characters: Character[];
  conversations: Conversation[];
  onBack: () => void;
  onOpenConversation: (id: string) => void;
  onSaveSuggestion: (s: PendingSuggestion) => Promise<void>;
  onIgnoreSuggestion: (s: PendingSuggestion) => void;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(getLang() === 'en' ? 'en-US' : 'th-TH', { day: 'numeric', month: 'short', year: 'numeric' });

export function MemoryPage(p: Props) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<MemoryType | ''>('');
  const [scope, setScope] = useState<string>('');
  const [editing, setEditing] = useState<Memory | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);

  const load = useCallback(async () => {
    if (!p.online) return;
    setLoading(true);
    setError(undefined);
    try {
      setMemories(await localService.memory.list());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [p.online]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return memories.filter(
      (m) =>
        (!q || m.content.toLowerCase().includes(q) || m.tags.some((t) => t.includes(q))) &&
        (!type || m.type === type) &&
        (!scope || (scope === 'shared' ? !m.characterId : m.characterId === scope)),
    );
  }, [memories, query, type, scope]);

  const suggestions: PendingSuggestion[] = useMemo(
    () =>
      p.conversations.flatMap((conversation) =>
        conversation.messages.flatMap((m) =>
          (m.memoryCandidates ?? []).filter((c) => c.status === 'pending').map((candidate) => ({ conversation, messageId: m.id, candidate })),
        ),
      ),
    [p.conversations],
  );

  const charName = (id: string | null) => (id ? p.characters.find((c) => c.id === id)?.name ?? 'Deleted character' : 'All characters');
  const conversationExists = (id: string | null) => !!id && p.conversations.some((c) => c.id === id);

  const patch = async (m: Memory, change: Partial<Memory>) => {
    const updated = await localService.memory.update(m.id, change);
    setMemories((list) => list.map((x) => (x.id === m.id ? updated : x)));
  };

  return (
    <main className="page">
      <header className="page-header">
        <button className="icon-btn" onClick={p.onBack} title="Back to chat">
          <ArrowLeft size={18} />
        </button>
        <div className="page-title">
          <h1>
            <Brain size={20} /> Memory
          </h1>
          <p>Things your AI remembers about you across chats. Only relevant memories are added to a prompt.</p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={load} title="Refresh" disabled={!p.online}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
          <button className="btn btn-primary" onClick={() => setEditing('new')} disabled={!p.online}>
            <Plus size={15} /> New memory
          </button>
        </div>
      </header>

      {!p.online ? (
        <ServiceOffline what="Memory" />
      ) : (
        <div className="page-body">
          {suggestions.length > 0 && (
            <section className="suggest-panel">
              <h3>Suggestions waiting for you · {suggestions.length}</h3>
              {suggestions.map((s) => (
                <div key={s.candidate.id} className="suggest-row">
                  <span className="badge">{TYPE_LABEL[s.candidate.type]}</span>
                  <span className="suggest-row-text">{s.candidate.content}</span>
                  <button className="link-btn muted" onClick={() => p.onOpenConversation(s.conversation.id)} title="Open the chat it came from">
                    {s.conversation.title}
                  </button>
                  <button
                    className="btn btn-soft btn-sm"
                    onClick={async () => {
                      await p.onSaveSuggestion(s);
                      load();
                    }}
                  >
                    <Check size={13} /> Save
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => p.onIgnoreSuggestion(s)}>
                    <X size={13} /> Ignore
                  </button>
                </div>
              ))}
            </section>
          )}

          <div className="filters">
            <label className="search page-search">
              <Search size={15} />
              <input placeholder={tr('ค้นหาความจำ', 'Search memories')} value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Filter by character">
              <option value="">All characters</option>
              <option value="shared">Shared only</option>
              {p.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  Only {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="chips">
            <button className={`chip ${!type ? 'active' : ''}`} onClick={() => setType('')}>
              All · {memories.length}
            </button>
            {MEMORY_TYPES.map((t) => {
              const n = memories.filter((m) => m.type === t).length;
              return (
                <button key={t} className={`chip ${type === t ? 'active' : ''}`} onClick={() => setType(type === t ? '' : t)} disabled={!n && type !== t}>
                  {TYPE_LABEL[t]} · {n}
                </button>
              );
            })}
          </div>

          {error && <div className="form-error">{error}</div>}

          {shown.length === 0 ? (
            <div className="page-empty">
              <Brain size={28} />
              <p>{memories.length ? 'No memories match these filters.' : 'No memories yet. Save suggestions from your chats, or add one yourself.'}</p>
            </div>
          ) : (
            <div className="memory-list">
              {shown.map((m) => (
                <article key={m.id} className={`memory-card ${m.pinned ? 'pinned' : ''}`}>
                  <div className="memory-content">{m.content}</div>
                  <div className="memory-meta">
                    <span className={`badge type-${m.type}`}>{TYPE_LABEL[m.type]}</span>
                    {m.tags.map((t) => (
                      <span key={t} className="tag">
                        #{t}
                      </span>
                    ))}
                    <span className="memory-scope">
                      {m.characterId ? <Avatar character={p.characters.find((c) => c.id === m.characterId)} size={16} /> : null}
                      {charName(m.characterId)}
                    </span>
                    <span title="Created">{fmtDate(m.createdAt)}</span>
                    {m.useCount > 0 && <span title="Times added to a prompt">used {m.useCount}×</span>}
                    {m.sourceConversationId &&
                      (conversationExists(m.sourceConversationId) ? (
                        <button className="link-btn" onClick={() => p.onOpenConversation(m.sourceConversationId!)}>
                          <MessageSquare size={12} /> {m.sourceConversationTitle ?? 'Source chat'}
                        </button>
                      ) : (
                        <span className="muted">from “{m.sourceConversationTitle ?? 'a deleted chat'}”</span>
                      ))}
                  </div>
                  <div className="memory-actions">
                    <Importance value={m.importance} onChange={(importance) => patch(m, { importance })} />
                    <button className="icon-btn icon-btn-sm" title={m.pinned ? 'Unpin' : 'Pin: always consider this memory'} onClick={() => patch(m, { pinned: !m.pinned })}>
                      {m.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                    <button className="icon-btn icon-btn-sm" title="Edit" onClick={() => setEditing(m)}>
                      <Pencil size={14} />
                    </button>
                    <button className="icon-btn icon-btn-sm danger-hover" title="Delete" onClick={() => setDeleting(m)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="page-foot muted small">Stored on this PC in {p.dataDir ? `${p.dataDir}\\memory.json` : 'data/memory.json'}.</p>
        </div>
      )}

      {editing && (
        <MemoryEditor
          memory={editing === 'new' ? undefined : editing}
          characters={p.characters}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setMemories((list) => (list.some((x) => x.id === saved.id) ? list.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...list]));
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this memory?"
          message={<>“{deleting.content}” will be forgotten. This can’t be undone.</>}
          onConfirm={async () => {
            await localService.memory.remove(deleting.id);
            setMemories((list) => list.filter((x) => x.id !== deleting.id));
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </main>
  );
}

function Importance({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="importance" title={`Importance ${value}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(n)} aria-label={`Importance ${n}`} className={n <= value ? 'on' : ''}>
          <Star size={12} fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  );
}

function MemoryEditor(props: { memory?: Memory; characters: Character[]; onClose: () => void; onSaved: (m: Memory) => void }) {
  const m = props.memory;
  const [content, setContent] = useState(m?.content ?? '');
  const [type, setType] = useState<MemoryType>(m?.type ?? 'user_fact');
  const [tags, setTags] = useState(m?.tags.join(', ') ?? '');
  const [importance, setImportance] = useState(m?.importance ?? 3);
  const [pinned, setPinned] = useState(m?.pinned ?? false);
  const [characterId, setCharacterId] = useState<string>(m?.characterId ?? '');
  const [error, setError] = useState<string>();

  const save = async () => {
    const body: NewMemory = {
      content: content.trim(),
      type,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      importance,
      pinned,
      characterId: characterId || null,
    };
    try {
      props.onSaved(m ? await localService.memory.update(m.id, body) : await localService.memory.create(body));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title={m ? 'Edit memory' : 'New memory'}
      onClose={props.onClose}
      size="md"
      footer={
        <>
          <button className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!content.trim()}>
            Save
          </button>
        </>
      }
    >
      <div className="form-stack">
        <label className="field">
          <span className="field-label">Memory</span>
          <textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="User's main GPU is AMD RX6600 8GB." autoFocus />
          <span className="field-hint">One fact per memory, written as a short sentence.</span>
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as MemoryType)}>
              {MEMORY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Who can use it</span>
            <select value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
              <option value="">All characters</option>
              {props.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  Only {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="field-label">
            Tags <span className="field-optional">optional, comma separated</span>
          </span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="hardware, gpu" />
        </label>
        <div className="field-row">
          <div className="field">
            <span className="field-label">Importance</span>
            <Importance value={importance} onChange={setImportance} />
          </div>
          <label className="check">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Pinned — always considered, even without matching words
          </label>
        </div>
        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  );
}

export function ServiceOffline({ what }: { what: string }) {
  return (
    <div className="page-empty">
      <Brain size={28} />
      <h3>{what} needs the PersonalAI local service</h3>
      <p>
        Start it with <code>start-personalai.bat</code> (starts the service and the web UI), or run <code>npm run service</code> in the
        PersonalAI folder. Chat keeps working without it.
      </p>
    </div>
  );
}
