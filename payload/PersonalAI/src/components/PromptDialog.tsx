import { useState, type ReactNode } from 'react';
import { Modal } from './Modal';

/** Small modal asking for one line of text (new folder, rename, move to…). */
export function PromptDialog(props: {
  title: string;
  label: string;
  initial?: string;
  hint?: ReactNode;
  confirmLabel?: string;
  onSubmit: (value: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(props.initial ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await props.onSubmit(value.trim());
      props.onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      size="sm"
      footer={
        <>
          <button className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !value.trim()}>
            {props.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">{props.label}</span>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          onFocus={(e) => {
            const dot = e.target.value.lastIndexOf('.');
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
          }}
        />
        {props.hint && <span className="field-hint">{props.hint}</span>}
      </label>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
