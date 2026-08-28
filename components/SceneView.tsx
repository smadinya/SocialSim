"use client";

import { useEffect, useRef } from "react";
import type { SceneLine } from "@/lib/reducer";
import type { WorldState } from "@/lib/viewTypes";

interface Props {
  scene: SceneLine[];
  world: WorldState;
  playerId: string;
}

export default function SceneView({ scene, world, playerId }: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [scene]);

  const present = world.scene.presentCharacters
    .map((id) => world.characters[id]?.name || id)
    .join(", ");
  const conversation = Object.values(world.conversations ?? {}).find(
    (item) => item.status === "active" && item.participants.includes(playerId),
  ) ?? Object.values(world.conversations ?? {}).find((item) => item.status === "active");
  const pendingRequests = conversation
    ? conversation.pendingRequestIds
        .map((id) => world.socialRequests?.[id])
        .filter((request) => request && !["fulfilled", "failed", "refused", "withdrawn"].includes(request.status))
    : [];
  const participantNames = conversation?.participants
    .map((id) => id === playerId ? "You" : world.characters[id]?.name ?? id)
    .join(" ↔ ");
  const expectedName = conversation?.expectedResponder
    ? conversation.expectedResponder === playerId
      ? "You"
      : world.characters[conversation.expectedResponder]?.name ?? conversation.expectedResponder
    : undefined;

  return (
    <section className="panel scene">
      <div className="panel-head">
        <span>Scene · {world.scene.location}</span>
        <span style={{ color: "var(--muted)" }}>{present}</span>
      </div>
      <div className="panel-body" ref={bodyRef}>
        {conversation && (
          <div className="scene-context">
            <div><b>{participantNames}</b> · {conversation.primaryTopic.summary}</div>
            <div className="context-meta">
              next: {expectedName ?? "open"} · {conversation.summary}
            </div>
            {pendingRequests.map((request) => request && (
              <span className="request-badge" key={request.id}>
                {request.status}: {request.subject}
              </span>
            ))}
          </div>
        )}
        {scene.map((line) => (
          <div
            key={line.id}
            className={`scene-line ${line.speaker === playerId ? "player" : ""} ${
              line.optimistic ? "optimistic" : ""
            }`}
          >
            {!line.optimistic && (
              <div className="who">
                {/* The player has a real name so NPCs can address them, but
                    their own lines still read as second person. */}
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
