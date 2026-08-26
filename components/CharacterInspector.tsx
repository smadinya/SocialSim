"use client";

import type { CharacterId, WorldState } from "@/lib/viewTypes";
import { REL_FIELDS } from "@/lib/format";
import TrustBar from "./TrustBar";

interface Props {
  world: WorldState;
  selectedId: CharacterId;
  playerId: CharacterId;
  onSelect: (id: CharacterId) => void;
}

export default function CharacterInspector({
  world,
  selectedId,
  playerId,
  onSelect,
}: Props) {
  const ids = Object.keys(world.characters);
  const present = world.scene.presentCharacters;
  const character = world.characters[selectedId];

  // All of them, on scene first. Filtering to the scene made the Bob-Calum
  // relationship unviewable while the feed reported it moving every other turn:
  // dead information in one panel, invisible consequence in another.
  const relTargets = ids
    .filter((id) => id !== selectedId && character?.relationships[id])
    .sort(
      (a, b) => Number(present.includes(b)) - Number(present.includes(a)),
    );
  const recentMemories = [...(character?.memories || [])]
    .sort((a, b) => b.turn - a.turn)
    .slice(0, 4);

  return (
    <section className="panel inspector">
      <div className="panel-head">
        <span>Inspector</span>
        <span style={{ color: "var(--muted)" }}>who&apos;s who</span>
      </div>
      <div className="panel-body">
        <div className="who-tabs">
          {ids.map((id) => {
            const onScene = present.includes(id);
            return (
              <button
                key={id}
                className={`who-tab ${id === selectedId ? "active" : ""} ${
                  onScene ? "" : "offscene"
                }`}
                onClick={() => onSelect(id)}
              >
                {world.characters[id].name}
                {id === playerId ? " ·you" : ""}
              </button>
            );
          })}
        </div>

        {character && (
          <>
            <div className="insp-name glow">{character.name}</div>
            <div className="insp-sub">
              mood: {character.state.mood}
              {present.includes(selectedId) ? " · on scene" : " · off scene"}
            </div>

            <div className="insp-label">Goals</div>
            {character.goals.map((g, i) => (
              <div className="goal" key={i}>
                {g}
              </div>
            ))}

            <div className="insp-label">Relationships</div>
            {relTargets.length === 0 && (
              <div className="feed-empty">Nobody else, yet.</div>
            )}
            {relTargets.map((id) => {
              const rel = character.relationships[id];
              if (!rel) return null;
              const onScene = present.includes(id);
              return (
                <div className={`rel-row ${onScene ? "" : "offscene"}`} key={id}>
                  <div className="rel-name">
                    <span>{world.characters[id].name}</span>
                    {!onScene && <span className="rel-where">off scene</span>}
                  </div>
                  {REL_FIELDS.map((field) => (
                    <TrustBar key={field} field={field} value={rel[field]} />
                  ))}
                </div>
              );
            })}

            <div className="insp-label">Beliefs</div>
            {character.beliefs.length === 0 && (
              <div className="feed-empty">Nothing firm yet.</div>
            )}
            {character.beliefs.map((b) => (
              <div className="belief" key={b.id}>
                {b.description}
                <div className="conf">
                  confidence {Math.round(b.confidence * 100)}%
                </div>
              </div>
            ))}

            <div className="insp-label">Recent memories</div>
            {recentMemories.length === 0 && (
              <div className="feed-empty">No memories yet.</div>
            )}
            {recentMemories.map((m) => (
              <div className="memory" key={m.id}>
                {m.description}
                <div className="meta">turn {m.turn}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
