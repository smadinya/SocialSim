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
  understoodOk: boolean;
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
  understoodOk,
  onCustom,
}: Props) {
  const needsTarget = metaFor(selectedMove).needsTarget;
  const regularMoves = moves.filter((id) => id !== "Wait");
  const columnCount = 3;
  const rowCount = Math.ceil(regularMoves.length / columnCount);

  return (
    <section className="panel menu">
      <div className="panel-head">
        <span>Actions</span>
        <span style={{ color: "var(--muted)" }}>{moves.length} available</span>
      </div>
      <div className="panel-body action-menu-body">
        <div className="action-options-scroll">
          <div className="menu-grid">
            {moves.map((id) => {
              const meta = metaFor(id);
              const regularIndex = regularMoves.indexOf(id);
              const position = id === "Wait"
                ? { gridColumn: "1 / -1", gridRow: rowCount + 1 }
                : {
                    gridColumn: Math.floor(regularIndex / rowCount) + 1,
                    gridRow: (regularIndex % rowCount) + 1,
                  };
              return (
                <button
                  key={id}
                  className={`menu-item ${id === "Wait" ? "wait-action" : ""} ${
                    id === selectedMove ? "active" : ""
                  }`}
                  disabled={busy}
                  onClick={() => onSelectMove(id)}
                  title={meta.blurb}
                  style={position}
                >
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
        </div>

        <CustomActionInput
          busy={busy}
          understoodAs={understoodAs}
          understoodOk={understoodOk}
          onSubmit={onCustom}
        />
      </div>
    </section>
  );
}
