import './characterManager.mobile.css';
import { Check, Copy, CopyPlus, Eye, ImageUp, MessageCirclePlus, Plus, Trash2, UserRound, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '../components/Avatar';
import { ConfirmDialog, Modal } from '../components/Modal';
import { previewSystemPrompt } from '../prompt/promptBuilder';
import type { Character, GreetingMode } from '../types';
import { fileToAvatar } from './avatarImage';
import { getLang } from '../i18n';
import { PERSONALITY_PRESETS, presetActive, togglePreset } from './personalityPresets';
import { duplicateCharacter, newCharacterDraft } from './useCharacters';

interface Props {
  characters: Character[];
  /** Character of the current chat. */
  activeId?: string;
  initialId?: string;
  /** Inputs the preview needs so it matches exactly what is sent. */
  globalPrompt: string;
  userName: string;
  greetingMode: GreetingMode;
  chatCount: (characterId: string) => number;
  onSave: (c: Character) => void;
  onDelete: (id: string) => void;
  onUse: (id: string) => void;
  /** Start a roleplay chat where this character is played. */
  onRoleplay?: (id: string) => void;
  onClose: () => void;
}

type Tab = 'profile' | 'preview';

/** Compares editable content only (timestamps change on every save). */
function sameProfile(a: Character, b: Character) {
  const strip = ({ createdAt: _c, updatedAt: _u, ...rest }: Character) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

export function CharacterManager(p: Props) {
  const initial = p.characters.find((c) => c.id === (p.initialId ?? p.activeId)) ?? p.characters[0];
  const [draft, setDraft] = useState<Character>(initial ?? newCharacterDraft());
  const [isNew, setIsNew] = useState(!initial);
  const [tab, setTab] = useState<Tab>('profile');
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string>();
  const [savedFlash, setSavedFlash] = useState(false);

  const saved = p.characters.find((c) => c.id === draft.id);
  const dirty = isNew || !saved || !sameProfile(saved, draft);
  const set = <K extends keyof Character>(key: K, value: Character[K]) => setDraft((d) => ({ ...d, [key]: value }));

  /** Runs `fn` now, or after asking to discard unsaved edits. */
  const guard = (fn: () => void) => (dirty ? setPendingNav(() => fn) : fn());

  const open = (c: Character) => {
    setDraft(c);
    setIsNew(false);
    setError(undefined);
    setSavedFlash(false);
  };

  const startNew = (base?: Character) => {
    const c = base ? duplicateCharacter(base, p.characters) : newCharacterDraft();
    setDraft(c);
    setIsNew(true);
    setTab('profile');
    setError(undefined);
    setSavedFlash(false);
  };

  const save = () => {
    if (!draft.name.trim()) {
      setTab('profile');
      setError('Give the character a name.');
      return false;
    }
    p.onSave({ ...draft, name: draft.name.trim() });
    setIsNew(false);
    setError(undefined);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
    return true;
  };

  const allowOtherCharacters=false;
  const listed = isNew ? [...p.characters, draft] : p.characters;

  return (
    <Modal title="Characters" onClose={() => guard(p.onClose)} size="lg">
      <div className="cm">
        <aside className="cm-list">
          {allowOtherCharacters && <button className="btn btn-soft cm-new" onClick={() => guard(() => startNew())}>
            <Plus size={15} /> New character
          </button>}
          {listed.map((c) => {
            const shown = c.id === draft.id ? draft : c;
            return (
              <button
                key={c.id}
                className={`cm-item ${c.id === draft.id ? 'active' : ''}`}
                onClick={() => c.id !== draft.id && guard(() => open(c))}
              >
                <Avatar character={shown} size={34} />
                <span className="cm-item-text">
                  <span className="cm-item-name">{shown.name || 'New character'}</span>
                  <span className="cm-item-sub">
                    {c.id === p.activeId ? 'In this chat' : shown.nickname || shown.description || ' '}
                  </span>
                </span>
              </button>
            );
          })}
        </aside>

        <section className="cm-main">
          <header className="cm-head">
            <Avatar character={draft} size={40} />
            <div className="cm-head-text">
              <div className="cm-head-name">{draft.name || 'New character'}</div>
              <div className="muted small">
                {isNew ? 'Not saved yet' : dirty ? 'Unsaved changes' : draft.nickname ? `“${draft.nickname}”` : 'Saved'}
              </div>
            </div>
            <div className="segmented cm-tabs">
              <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>
                <UserRound size={14} /> Profile
              </button>
              <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>
                <Eye size={14} /> Prompt preview
              </button>
            </div>
          </header>

          <div className="cm-body">
            {tab === 'profile' ? (
              <ProfileForm draft={draft} set={set} onAvatarError={setError} />
            ) : (
              <PromptPreview
                text={previewSystemPrompt({
                  globalPrompt: p.globalPrompt,
                  character: draft,
                  userName: p.userName,
                  greetingMode: p.greetingMode,
                })}
                greetingMode={p.greetingMode}
                hasGreeting={!!draft.firstMessage.trim()}
                dirty={dirty}
              />
            )}
            {error && <div className="form-error">{error}</div>}
          </div>

          <footer className="cm-actions">
            {allowOtherCharacters && !isNew && (
              <>
                <button className="btn btn-ghost danger-text" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={15} /> Delete
                </button>
                <button className="btn btn-ghost" onClick={() => guard(() => startNew(draft))} title="Duplicate">
                  <CopyPlus size={15} /> Duplicate
                </button>
              </>
            )}
            <div className="grow" />
            {!isNew && draft.id !== p.activeId && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  if (dirty && !save()) return;
                  p.onUse(draft.id);
                }}
              >
                <MessageCirclePlus size={15} /> Chat with {draft.name || 'character'}
              </button>
            )}
            {allowOtherCharacters && !isNew && p.onRoleplay && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  if (dirty && !save()) return;
                  p.onRoleplay!(draft.id);
                }}
                title="แชตใหม่ที่ Nova เล่นเป็นตัวละครนี้ (ไม่ใช้เว็บ/คลัง/ความจำ ไม่มีเสียง)"
              >
                🎭 เริ่มโรลเพลย์
              </button>
            )}
            <button className="btn btn-primary" onClick={save} disabled={!dirty}>
              {savedFlash && !dirty ? (
                <>
                  <Check size={15} /> Saved
                </>
              ) : isNew ? (
                'Create'
              ) : (
                'Save'
              )}
            </button>
          </footer>
        </section>
      </div>

      {pendingNav && (
        <ConfirmDialog
          title="Discard changes?"
          message={`Your edits to ${draft.name || 'this character'} haven’t been saved.`}
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          onConfirm={() => pendingNav()}
          onCancel={() => setPendingNav(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${draft.name || 'character'}?`}
          message={
            <>
              This removes the character profile.
              {p.chatCount(draft.id) > 0 && (
                <>
                  {' '}
                  Its <b>{p.chatCount(draft.id)}</b> chat{p.chatCount(draft.id) > 1 ? 's stay' : ' stays'} in your
                  history as read-only, so it never continues with a different personality.
                </>
              )}
            </>
          }
          onConfirm={() => {
            p.onDelete(draft.id);
            const next = p.characters.find((c) => c.id !== draft.id);
            if (next) open(next);
            else startNew();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}

/* ---------------- Profile form ---------------- */

function ProfileForm({
  draft,
  set,
  onAvatarError,
}: {
  draft: Character;
  set: <K extends keyof Character>(key: K, value: Character[K]) => void;
  onAvatarError: (msg?: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      set('avatar', await fileToAvatar(file));
      onAvatarError(undefined);
    } catch (e: any) {
      onAvatarError(e.message);
    }
  };

  return (
    <div className="cm-form">
      <FormGroup title="Identity">
        <div className="cm-identity">
          <div className="cm-avatar">
            <button className="cm-avatar-btn" onClick={() => fileRef.current?.click()} title="Upload avatar">
              <Avatar character={draft} size={96} />
              <span className="cm-avatar-overlay">
                <ImageUp size={18} />
              </span>
            </button>
            <div className="cm-avatar-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                {draft.avatar ? 'Change' : 'Upload'}
              </button>
              {draft.avatar && (
                <button className="btn btn-ghost btn-sm" onClick={() => set('avatar', '')} aria-label="Remove avatar">
                  <X size={14} />
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <div className="cm-identity-fields">
            <div className="field-row">
              <Field label="Name">
                <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Lumicos" maxLength={60} />
              </Field>
              <Field label="Nickname" optional>
                <input
                  value={draft.nickname ?? ''}
                  onChange={(e) => set('nickname', e.target.value)}
                  placeholder="มิน่า"
                  maxLength={40}
                />
              </Field>
            </div>
            <Field label="Description" hint="One line. Shown in the sidebar and panel, and sent to the model.">
              <input
                value={draft.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="A local personal AI companion."
                maxLength={160}
              />
            </Field>
          </div>
        </div>
      </FormGroup>

      <FormGroup title="Personality & voice">
        <div className="cm-presets" role="group" aria-label={getLang() === 'th' ? 'เลือกบุคลิกคร่าว ๆ' : 'Quick personality picks'}>
          <span className="cm-presets-label">{getLang() === 'th' ? 'เลือกบุคลิกคร่าว ๆ (เลือกได้หลายแบบ)' : 'Quick personality picks (choose several)'}</span>
          <div className="cm-presets-row">
            {PERSONALITY_PRESETS.map((pr) => (
              <button
                key={pr.id}
                type="button"
                className={'cm-chip' + (presetActive(draft.personality, pr) ? ' on' : '')}
                aria-pressed={presetActive(draft.personality, pr)}
                onClick={() => {
                  const r = togglePreset(draft.personality, draft.speakingStyle, pr);
                  set('personality', r.personality);
                  set('speakingStyle', r.speakingStyle);
                }}
              >
                {getLang() === 'th' ? pr.th : pr.en}
              </button>
            ))}
          </div>
        </div>
        <Field label="Personality">
          <AutoTextarea
            value={draft.personality}
            onChange={(v) => set('personality', v)}
            placeholder="Warm, intelligent, calm, curious…"
            minRows={2}
          />
        </Field>
        <Field label="Speaking style">
          <AutoTextarea
            value={draft.speakingStyle}
            onChange={(v) => set('speakingStyle', v)}
            placeholder="Natural conversational Thai. Avoid stiff wording…"
            minRows={3}
          />
        </Field>
      </FormGroup>

      <FormGroup title="Relationship & rules">
        <Field label="Relationship with user" optional>
          <AutoTextarea
            value={draft.userRelationship ?? ''}
            onChange={(v) => set('userRelationship', v)}
            placeholder="Personal AI companion."
            minRows={1}
          />
        </Field>
        <Field label="Behavior rules" optional hint="One rule per line. A leading “-” is added automatically.">
          <AutoTextarea
            value={draft.behaviorRules ?? ''}
            onChange={(v) => set('behaviorRules', v)}
            placeholder={'- Maintain personality consistently.\n- Do not constantly mention being an AI.'}
            minRows={4}
            mono
          />
        </Field>
      </FormGroup>

      <FormGroup title="Advanced">
        <Field
          label="Additional instructions"
          optional
          hint="Anything else for this character. Added after the fields above. Supports {{char}} and {{user}}."
        >
          <AutoTextarea
            value={draft.systemPrompt}
            onChange={(v) => set('systemPrompt', v)}
            placeholder="e.g. Prefer bullet points for technical answers."
            minRows={2}
          />
        </Field>
      </FormGroup>

      <FormGroup title="Greeting">
        <Field label="First message" optional hint="Shown at the start of every new chat with this character.">
          <AutoTextarea
            value={draft.firstMessage}
            onChange={(v) => set('firstMessage', v)}
            placeholder="ว่าไง วันนี้อยากให้เราช่วยอะไร"
            minRows={2}
          />
        </Field>
      </FormGroup>
    </div>
  );
}

/* ---------------- Prompt preview ---------------- */

const GREETING_NOTE: Record<GreetingMode, string> = {
  'context-note': 'The First Message is described in the system prompt (the “Conversation Start” section), not sent as a model reply.',
  'assistant-turn': 'The First Message is sent as the first assistant message, before your first message.',
  'ui-only': 'The First Message is only shown in the chat. The model never sees it.',
};

function PromptPreview(props: { text: string; greetingMode: GreetingMode; hasGreeting: boolean; dirty: boolean }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => props.text.split('\n'), [props.text]);

  const copy = async () => {
    await navigator.clipboard.writeText(props.text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="preview">
      <div className="preview-bar">
        <div>
          <div className="preview-title">System prompt sent to the model</div>
          <div className="muted small">
            For a new chat with this character{props.dirty ? ', including unsaved edits' : ''}. The conversation messages
            follow it. <code>[Relevant Memory]</code> and <code>[Tools]</code> are added per message, only when relevant.
          </div>
        </div>
        <button className="btn btn-soft btn-sm" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="preview-text">
        {lines.map((line, i) => (
          <span key={i} className={/^\[.+\]$/.test(line) ? 'pv-section' : /^[A-Z][\w ]+:$/.test(line) ? 'pv-label' : undefined}>
            {line}
            {'\n'}
          </span>
        ))}
      </pre>
      <div className="preview-meta">
        <span>{props.text.length.toLocaleString()} characters</span>
        {props.hasGreeting && <span>{GREETING_NOTE[props.greetingMode]}</span>}
      </div>
    </div>
  );
}

/* ---------------- Small form parts ---------------- */

function FormGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="form-group">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Field(props: { label: string; hint?: string; optional?: boolean; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {props.label}
        {props.optional && <span className="field-optional">optional</span>}
      </span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

function AutoTextarea(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number;
  mono?: boolean;
}) {
  const rows = Math.max(props.minRows ?? 2, Math.min(14, props.value.split('\n').length + 1));
  return (
    <textarea
      className={props.mono ? 'mono' : undefined}
      rows={rows}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}
