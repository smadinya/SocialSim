"use client";

import type { MoveId, PendingRequest } from "@/lib/viewTypes";
import type { MenuRow } from "@/lib/moveMeta";
import { MENU_ROWS, metaFor } from "@/lib/moveMeta";
import CustomActionInput from "./CustomActionInput";

interface Option {
  id: string;
  name: string;
}

interface Props {
  row: MenuRow;
  onSelectRow: (row: MenuRow) => void;
  moves: MoveId[];
  selectedMove: MoveId;
  onSelectMove: (id: MoveId) => void;

  targets: Option[];
  selectedTarget: string | null;
  onSelectTarget: (id: string) => void;

  /** Where the player can walk from here. Only read for `GoTo`. */
  exits: Option[];
  selectedExit: string | null;
  onSelectExit: (id: string) => void;

  /** What the player can ask about. Only read for `AskAbout`. */
  topics: Option[];
  selectedTopic: string | null;
  onSelectTopic: (id: string) => void;

  /** Live asks aimed at the player. The response row is pinned above the grid. */
  requests: PendingRequest[];
  nameOf: (id: string) => string;
  turn: number;
  onRespond: (moveId: MoveId, asker: string) => void;

  /** `Fight` is unreachable until things are already bad. */
  fightUnlocked: boolean;

  onCommit: () => void;
  busy: boolean;
  understoodAs: string | null;
  understoodOk: boolean;
  onCustom: (text: string) => void;
}

export default function ActionMenu({
  row,
  onSelectRow,
  moves,
  selectedMove,
  onSelectMove,
  targets,
  selectedTarget,
  onSelectTarget,
  exits,
  selectedExit,
  onSelectExit,
  topics,
  selectedTopic,
  onSelectTopic,
  requests,
  nameOf,
  turn,
  onRespond,
  fightUnlocked,
  onCommit,
  busy,
  understoodAs,
  understoodOk,
  onCustom,
}: Props) {
  const meta = metaFor(selectedMove);
  const picking: "exit" | "topic" | "target" | "none" =
    selectedMove === "GoTo"
      ? "exit"
      : meta.needsTopic
        ? "topic"
        : meta.needsTarget
          ? "target"
          : "none";

  return (
    <section className="panel menu">
      <div className="panel-head">
        <span>Actions</span>
        <span style={{ color: "var(--muted)" }}>tab · rows · press 1–{moves.length}</span>
      </div>
      <div className="panel-body">
        {requests.length > 0 && (
          <div className="request-row">
            {requests.map((r) => (
              <div className="request" key={r.id}>
                <div className="request-what">
                  <b>{nameOf(r.from)}</b>{" "}
                  {r.moveId === "Propose" ? "wants to work together" : "asked you for help"}
                  <span className="request-ttl">
                    {Math.max(0, r.expiresTurn - turn)} turns to answer
                  </span>
                </div>
                <div className="request-actions">
                  <button
                    className="chip warm"
                    disabled={busy}
                    onClick={() => onRespond("Comply", r.from)}
                  >
                    Agree
                  </button>
                  <button
                    className="chip cold"
                    disabled={busy}
                    onClick={() => onRespond("Refuse", r.from)}
                  >
                    Refuse
                  </button>
                  <button
                    className="chip"
                    disabled={busy}
                    onClick={() => onRespond("Withdraw", r.from)}
                  >
                    Deflect
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="row-tabs">
          {MENU_ROWS.map((r) => (
            <button
              key={r}
              className={`row-tab ${r === row ? "active" : ""}`}
              disabled={busy}
              onClick={() => onSelectRow(r)}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="menu-grid">
          {moves.map((id, i) => {
            const m = metaFor(id);
            const locked = id === "Fight" && !fightUnlocked;
            return (
              <button
                key={id}
                className={`menu-item ${id === selectedMove ? "active" : ""} ${
                  locked ? "locked" : ""
                }`}
                disabled={busy || locked}
                title={locked ? "Not until things are worse than this." : m.blurb}
                onClick={() => onSelectMove(id)}
              >
                <span className="key">{i + 1}</span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>

        <div className="target-row">
          {picking === "target" && (
            <>
              <span className="lbl">on</span>
              {targets.length === 0 && <span className="lbl">nobody here</span>}
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
            </>
          )}

          {picking === "topic" && (
            <>
              <span className="lbl">ask</span>
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
              <span className="lbl">about</span>
              {topics.map((t) => (
                <button
                  key={t.id}
                  className={`chip ${t.id === selectedTopic ? "active" : ""}`}
                  disabled={busy}
                  onClick={() => onSelectTopic(t.id)}
                >
                  {t.name}
                </button>
              ))}
            </>
          )}

          {picking === "exit" && (
            <>
              <span className="lbl">to</span>
              {exits.map((e) => (
                <button
                  key={e.id}
                  className={`chip ${e.id === selectedExit ? "active" : ""}`}
                  disabled={busy}
                  onClick={() => onSelectExit(e.id)}
                >
                  {e.name}
                </button>
              ))}
            </>
          )}

          <button className="chip go" disabled={busy} onClick={onCommit}>
            Execute ▸
          </button>
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
