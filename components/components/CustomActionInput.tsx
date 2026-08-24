"use client";

import { useState } from "react";

interface Props {
  busy: boolean;
  understoodAs: string | null;
  onSubmit: (text: string) => void;
}

export default function CustomActionInput({
  busy,
  understoodAs,
  onSubmit,
}: Props) {
  const [text, setText] = useState("");

  function send() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onSubmit(trimmed);
    setText("");
  }

  return (
    <div className="custom">
      <div className="custom-row">
        <input
          type="text"
          value={text}
          placeholder="type an action — e.g. confront bob"
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
        />
        <button onClick={send} disabled={busy}>
          {busy ? <span className="spinner">…</span> : "Send"}
        </button>
      </div>
      {understoodAs && (
        <div className="understood">
          I understood that as: <b>{understoodAs}</b>
        </div>
      )}
    </div>
  );
}
