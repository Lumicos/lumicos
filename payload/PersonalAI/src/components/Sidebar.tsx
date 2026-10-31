import {
  Brain,
  Check,
  HardDrive,
  MessageSquare,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings as SettingsIcon,
  SquarePen,
  Trash2,
  Users,
  X,
  Wand2,
} from 'lucide-react';
import { ASSISTANT_ID } from '../config/defaults';
import { useEffect, useMemo, useRef, useState } from 'react';
import { textOf } from '../chat/messageUtils';
import type { Character, Conversation } from '../types';
import { Avatar } from './Avatar';
import { LumicosLogo } from './LumicosLogo';
import { ConfirmDialog } from './Modal';

const BUILTIN_AGENTS = new Set([ASSISTANT_ID]);
export type View = 'chat' | 'memory' | 'workspace' | 'gallery' | 'imageedit';

interface Props {
  open: boolean;
  view: View;
  serviceOnline: boolean;
  /** When false (installer skipped Z-Image), hide Image Lab nav. Default true for older installs. */
  showImageLab?: boolean;
  onNavigate: (view: View) => void;
  conversations: Conversation[];
  activeId: string;
  busy: boolean;
  characters: Character[];
  showRoleplayAgents?: boolean;
  /** Character of the open chat (may point at a deleted character). */
  currentCharacterId?: string;
  /** Shown in the character picker. */
  pickerCharacter?: Character;
  /** Avatar page is Lumicos-only. */
  showAvatar?: boolean;
  historyFilter: 'character' | 'all';
  onHistoryFilter: (f: 'character' | 'all') => void;
  onToggle: () => void;
  onNewChat: () => void;
  onNewRoleplay?: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onPickCharacter: (id: string) => void;
  onManageCharacters: () => void;
  onOpenSettings: () => void;
}

function groupLabel(ts: number) {
  const day = 86_400_000;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfToday - day) return 'Yesterday';
  if (ts >= startOfToday - 7 * day) return 'Previous 7 days';
  if (ts >= startOfToday - 30 * day) return 'Previous 30 days';
  return 'Older';
}

export function Sidebar(p: Props) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const scoped =
      (p.historyFilter === 'character' ? p.conversations.filter((c) => c.characterId === p.currentCharacterId) : p.conversations).filter((c) => c.mode !== 'roleplay');
    const list = q
      ? scoped.filter(
          (c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => textOf(m).toLowerCase().includes(q)),
        )
      : scoped;
    const map = new Map<string, Conversation[]>();
    for (const c of list) {
      const g = groupLabel(c.updatedAt);
      map.set(g, [...(map.get(g) ?? []), c]);
    }
    return [...map.entries()];
  }, [p.conversations, p.historyFilter, p.currentCharacterId, query]);

  const charOf = (id?: string) => p.characters.find((c) => c.id === id);

  if (!p.open) {
    return (
      <aside className="sidebar sidebar-rail">
        <button className="icon-btn" onClick={p.onToggle} title="Open sidebar">
          <PanelLeftOpen size={18} />
        </button>
        <button className="icon-btn" onClick={p.onNewChat} title="New chat" disabled={p.busy}>
          <SquarePen size={18} />
        </button>
        <button className={`icon-btn ${p.view === 'memory' ? 'active' : ''}`} onClick={() => p.onNavigate('memory')} title="Memory">
          <Brain size={18} />
        </button>
        <button className={`icon-btn ${p.view === 'workspace' ? 'active' : ''}`} onClick={() => p.onNavigate('workspace')} title="Workspace">
          <HardDrive size={18} />
        </button>
        <button className="rail-avatar" onClick={p.onManageCharacters} title={p.pickerCharacter?.name}>
          <Avatar character={p.pickerCharacter} size={30} />
        </button>
        <div className="grow" />
        <button className="icon-btn" onClick={p.onOpenSettings} title="Settings">
          <SettingsIcon size={18} /><span>ตั้งค่า</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <LumicosLogo />
        </div>
        <button className="icon-btn" onClick={p.onToggle} title="Collapse sidebar">
          <PanelLeftClose size={18} />
        </button>
      </div>

      <div className="sidebar-scroll">
      <button
        className="new-chat"
        onClick={() => {
          p.onNewChat();
          p.onNavigate('chat');
        }}
        disabled={p.busy}
      >
        <Plus size={20} /> แชตใหม่
      </button>
      {p.onNewRoleplay && (
        <button className="new-chat" onClick={() => { p.onNewRoleplay!(); p.onNavigate('chat'); }} disabled={p.busy}>
          <Plus size={20} /> โรลเพลย์ใหม่
        </button>
      )}

      <label className="search">
        <Search size={15} />
        <input placeholder="ค้นหาแชต" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </label>



      <nav className="side-nav" aria-label="เครื่องมือ Lumicos">
        <button className={p.view === 'chat' ? 'active' : ''} onClick={() => p.onNavigate('chat')}>
          <MessageSquare size={19} /> แชต
        </button>
        <button className={p.view === 'memory' ? 'active' : ''} onClick={() => p.onNavigate('memory')}>
          <Brain size={19} /> ความจำ
          {!p.serviceOnline && <span className="side-nav-dot" title="Local service offline" />}
        </button>
        <button className={p.view === 'workspace' ? 'active' : ''} onClick={() => p.onNavigate('workspace')}>
          <HardDrive size={19} /> ไฟล์
          {!p.serviceOnline && <span className="side-nav-dot" title="Local service offline" />}
        </button>
        {p.showImageLab !== false && (
          <button className={p.view === 'imageedit' ? 'active' : ''} onClick={() => p.onNavigate('imageedit')}><Wand2 size={19}/> Image Lab</button>
        )}

      </nav>

      <div className="history-filter segmented">
        <button className={p.historyFilter === 'character' ? 'active' : ''} onClick={() => p.onHistoryFilter('character')}>
          {charOf(p.currentCharacterId)?.name ?? 'This character'}
        </button>
        <button className={p.historyFilter === 'all' ? 'active' : ''} onClick={() => p.onHistoryFilter('all')}>
          All chats
        </button>
      </div>

      <nav className="history" aria-label="ประวัติแชท">
        {groups.map(([label, items]) => (
          <div key={label} className="history-group">
            <div className="history-label">{label}</div>
            {items.map((c) => (
              <HistoryItem
                key={c.id}
                conversation={c}
                character={p.historyFilter === 'all' ? charOf(c.characterId) ?? null : undefined}
                active={c.id === p.activeId}
                editing={editingId === c.id}
                busy={p.busy}
                onSelect={() => {
                  p.onSelect(c.id);
                  p.onNavigate('chat');
                }}
                onStartRename={() => setEditingId(c.id)}
                onRename={(t) => {
                  p.onRename(c.id, t);
                  setEditingId(null);
                }}
                onCancelRename={() => setEditingId(null)}
                onDelete={() => setDeleting(c)}
              />
            ))}
          </div>
        ))}
        {!groups.length && <div className="history-empty">{query ? 'No matching chats' : 'No chats yet'}</div>}
      </nav>



      </div>

      <div className="sidebar-foot">
        <div className="char-picker">
          <button className="char-current" onClick={() => setPickerOpen((o) => !o)} disabled={p.busy}>
            <Avatar character={p.pickerCharacter} size={32} />
            <span className="char-current-text">
              <span className="char-current-name">{p.pickerCharacter?.name ?? 'No character'}</span>
              <span className="char-current-desc">{p.pickerCharacter?.description || 'Character'}</span>
            </span>
            <ChevronsUpDown size={15} className="muted" />
          </button>
          {pickerOpen && (
            <CharacterMenu
              characters={p.showRoleplayAgents ? p.characters : p.characters.filter((c) => BUILTIN_AGENTS.has(c.id) || c.id === p.pickerCharacter?.id)}
              activeId={p.pickerCharacter?.id}
              onPick={(id) => {
                p.onPickCharacter(id);
                setPickerOpen(false);
              }}
              onManage={() => {
                p.onManageCharacters();
                setPickerOpen(false);
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
        <button className="icon-btn" onClick={p.onOpenSettings} title="Settings">
          <SettingsIcon size={18} /><span>ตั้งค่า</span>
        </button>
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete chat?"
          message={
            <>
              <b>{deleting.title}</b> and all its messages will be deleted. This can’t be undone.
            </>
          }
          onConfirm={() => p.onDelete(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </aside>
  );
}

function HistoryItem(props: {
  conversation: Conversation;
  /** Shown in "All chats": the chat's character (null = deleted). */
  character?: Character | null;
  active: boolean;
  editing: boolean;
  busy: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onRename: (title: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
}) {
  const { conversation: c } = props;
  const [draft, setDraft] = useState(c.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (props.editing) {
      setDraft(c.title);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [props.editing, c.title]);

  if (props.editing) {
    return (
      <form
        className="history-item editing"
        onSubmit={(e) => {
          e.preventDefault();
          props.onRename(draft);
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && props.onCancelRename()}
          onBlur={() => props.onRename(draft)}
          maxLength={80}
        />
        <button type="submit" className="mini-btn" aria-label="Save">
          <Check size={14} />
        </button>
      </form>
    );
  }

  return (
    <div
      className={`history-item ${props.active ? 'active' : ''} ${props.busy && !props.active ? 'locked' : ''}`}
      onClick={props.onSelect}
      onDoubleClick={props.onStartRename}
      title={c.title}
    >
      {props.character !== undefined && (
        <Avatar character={props.character ?? { name: '?', avatar: '' }} size={20} className="history-avatar" />
      )}
      <span className="history-title">{c.mode === 'roleplay' ? '🎭 ' : ''}{c.title}</span>
      <span className="history-actions">
        <button
          className="mini-btn"
          title="Rename"
          onClick={(e) => {
            e.stopPropagation();
            props.onStartRename();
          }}
        >
          <Pencil size={13} />
        </button>
        <button
          className="mini-btn danger"
          title="Delete"
          disabled={props.busy}
          onClick={(e) => {
            e.stopPropagation();
            props.onDelete();
          }}
        >
          <Trash2 size={13} />
        </button>
      </span>
    </div>
  );
}

function CharacterMenu(props: {
  characters: Character[];
  activeId?: string;
  onPick: (id: string) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [props]);

  return (
    <div className="popover char-menu" ref={ref}>
      <div className="popover-label">Characters</div>
      {props.characters.map((c) => (
        <button key={c.id} className="popover-item" onClick={() => props.onPick(c.id)}>
          <Avatar character={c} size={26} />
          <span className="popover-item-text">
            <span>{c.name || 'Untitled'}</span>
            {c.description && <span className="muted small">{c.description}</span>}
          </span>
          {c.id === props.activeId && <Check size={15} className="accent" />}
        </button>
      ))}
      <div className="popover-sep" />
      <button className="popover-item" onClick={props.onManage}>
        <Users size={16} /> Manage characters
      </button>
    </div>
  );
}
