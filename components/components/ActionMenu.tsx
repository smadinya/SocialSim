"use client";

import type { MoveId } from "@/lib/viewTypes";
import { metaFor } from "@/lib/moveMeta";
import CustomActionInput from "./CustomActionInput";

interface TargetOption {
  id: string;
  name: string;
}

interface Props {
  moves: MoveId[];
  selectedMove: MoveId;
  onSelectMove: (id: MoveId) => void;
  targets: TargetOption[];
  selectedTarget: string | null;
  onSelectTarget: (id: string) => void;
  onCommit: () => void;
  busy: boolean;
  understoodAs: string | null;
  onCustom: (text: string) => void;
}

export default function ActionMenu({
  moves,
  selectedMove,
  onSelectMove,
  targets,
  selectedTarget,
  onSelectTarget,
  onCommit,
  busy,
  understoodAs,
  onCustom,
}: Props) {
  const needsTarget = metaFor(selectedMove).needsTarget;

  return (
    <section className="panel menu">
      <div className="panel-head">
        <span>Actions</span>
        <span style={{ color: "var(--muted)" }}>press 1–{moves.length}</span>
      </div>
      <div className="panel-body">
        <div className="menu-grid">
          {moves.map((id, i) => {
            const meta = metaFor(id);
            return (
              <button
                key={id}
                className={`menu-item ${id === selectedMove ? "active" : ""}`}
                disabled={busy}
                onClick={() => onSelectMove(id)}
              >
                <span className="key">{i + 1}</span>
                <span>{meta.label}</span>
              </button>
            );
          })}
        </div>

        {needsTarget && (
          <div className="target-row">
            <span className="lbl">on</span>
            {targets.map((t) => (
              <button
                key={t.id}
                className={`chip ${t.id === selectedTarget ? "active" : ""}`}
                disabled={busy}
                onClick={() => onSelectTarget(t.id)}
              >
                {t.name}
              </button>
            ))}
            <button className="chip" disabled={busy} onClick={onCommit}>
              Execute ▸
            </button>
          </div>
        )}

        {!needsTarget && (
          <div className="target-row">
            <button className="chip" disabled={busy} onClick={onCommit}>
              Execute ▸
            </button>
          </div>
        )}

        <CustomActionInput
          busy={busy}
          understoodAs={understoodAs}
          onSubmit={onCustom}
        />
      </div>
    </section>
  );
}
