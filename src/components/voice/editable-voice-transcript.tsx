"use client";

import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";

type EditableVoiceTranscriptProps = {
  text: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
  label?: string;
};

export function EditableVoiceTranscript({ text, onCommit, onCancel, label = "What YiYi heard" }: EditableVoiceTranscriptProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState("");

  function beginEdit() {
    setDraft(text);
    setError("");
    setEditing(true);
  }

  function commit() {
    const next = draft.trim();
    if (!next) {
      setError("Transcript cannot be empty.");
      return;
    }
    onCommit(next);
    setEditing(false);
    setError("");
  }

  function cancel() {
    setEditing(false);
    setError("");
    onCancel();
  }

  return <section className="editable-voice-transcript" aria-label="Voice transcript">
    <div className="editable-voice-transcript-heading"><span>{label}</span></div>
    {editing ? <div className="editable-voice-transcript-editor">
      <textarea aria-label="Voice transcript" value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }} rows={3} autoFocus />
      <div className="editable-voice-transcript-actions">
        <button className="transcript-action" type="button" aria-label="Use edited transcript" onClick={commit}><Check size={18} /></button>
        <button className="transcript-action" type="button" aria-label="Cancel transcript edit" onClick={cancel}><X size={18} /></button>
      </div>
      {error && <p className="editable-voice-transcript-error" role="alert">{error}</p>}
    </div> : <div className="editable-voice-transcript-display">
      <p>{text}</p>
      <button className="transcript-action" type="button" aria-label="Edit transcript" onClick={beginEdit}><Pencil size={18} /></button>
    </div>}
  </section>;
}
