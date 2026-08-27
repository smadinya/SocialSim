"use client";

import type { CharacterId, WorldState } from "@/lib/viewTypes";
import { STATUS_BLURB, currentStatus } from "@/lib/relationships";

interface Props {
  world: WorldState;
  onPick: (id: CharacterId) => void;
  onClose: () => void;
}

/**
 * Who is whose friend, in one grid. Rows are the person doing the feeling —
 * relationships are directed, so `Alice → Bob` and `Bob → Alice` are different
 * cells and are allowed to disagree. That asymmetry is the whole game and the
 * four-bar inspector could only ever show one side of it at a time.
 */
export default function RelationshipMap({ world, onPick, onClose }: Props) {
  const ids = Object.keys(world.characters);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="map" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span>Who&apos;s who</span>
          <span style={{ color: "var(--muted)" }}>rows feel · columns are felt about</span>
        </div>
        <div className="map-body">
          <table className="map-grid">
            <thead>
              <tr>
                <th />
                {ids.map((id) => (
                  <th key={id}>{world.characters[id].name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ids.map((from) => (
                <tr key={from}>
                  <th onClick={() => onPick(from)}>{world.characters[from].name}</th>
                  {ids.map((to) => {
                    if (from === to) return <td key={to} className="self">—</td>;
                    const rel = world.characters[from].relationships[to];
                    if (!rel) return <td key={to} className="self">·</td>;
                    const status = currentStatus(rel);
                    const last = rel.history[rel.history.length - 1];
                    return (
                      <td
                        key={to}
                        className={`cell ${status}`}
                        onClick={() => onPick(from)}
                        title={`${world.characters[from].name} ${STATUS_BLURB[status]} ${world.characters[to].name}`}
                      >
                        <span className="cell-status">{status}</span>
                        {last && (
                          <span className="cell-was">
                            was {last.was} · turn {last.turn}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="map-foot">
          <button className="chip" onClick={onClose}>
            close
          </button>
        </div>
      </div>
    </div>
  );
}
