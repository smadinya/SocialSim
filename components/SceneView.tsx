"use client";

import { useEffect, useRef } from "react";
import type { SceneLine } from "@/lib/reducer";
import type { WorldState } from "@/lib/viewTypes";
import type { TalkingPair } from "@/lib/conversations";

interface Props {
  scene: SceneLine[];
  world: WorldState;
  playerId: string;
  pairs: TalkingPair[];
}

export default function SceneView({ scene, world, playerId, pairs }: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [scene]);

  const here = world.locations[world.scene.location];
  const present = world.scene.presentCharacters
    .map((id) => world.characters[id]?.name || id)
    .join(", ");

  return (
    <section className="panel scene">
      <div className="panel-head">
        <span>Scene · {here?.name ?? world.scene.location}</span>
        <span style={{ color: "var(--muted)" }}>{present}</span>
      </div>

      {/* Who is talking to whom, and what about. The header used to be a flat
          comma list of everyone in the room, which said nothing about which of
          them were actually in a conversation with each other. */}
      {pairs.length > 0 && (
        <div className="talking">
          {pairs.map((p) => (
            <span key={p.id} className={`pair ${p.heatLabel ? "hot" : ""}`}>
              <b>{p.aName}</b> → <b>{p.bName}</b>
              {p.topicLabel && <span className="pair-topic"> · {p.topicLabel}</span>}
              {p.heatLabel && <span className="pair-heat"> · {p.heatLabel}</span>}
            </span>
          ))}
        </div>
      )}

      <div className="panel-body" ref={bodyRef}>
        {scene.map((line) => (
          <div
            key={line.id}
            className={`scene-line ${line.speaker === playerId ? "player" : ""} ${
              line.optimistic ? "optimistic" : ""
            }`}
          >
            {!line.optimistic && (
              <div className="who">
                {line.speaker === playerId ? "You" : line.speakerName}
              </div>
            )}
            <div className="said">
              {line.text}
              {line.streaming && <span className="cursor" />}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
