"use client";

import { useEffect, useRef } from "react";
import type { SceneLine } from "@/lib/reducer";
import type { WorldState } from "@/lib/viewTypes";
import type { TalkingPair } from "@/lib/conversations";
import { openRequestsForPlayer } from "@/lib/requestMoves";

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
  const conversation = Object.values(world.conversations ?? {}).find(
    (item) => item.status === "active" && item.participants.includes(playerId),
  ) ?? Object.values(world.conversations ?? {}).find((item) => item.status === "active");
  const openRequests = openRequestsForPlayer(world, playerId);
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

      {/* Track A's conversation record and the open-request stack. Both are
          empty while the mock engine is the one running, so this renders
          nothing until the `sim/` port populates them — the pair line above is
          what the player sees today. */}
      {(conversation || openRequests.length > 0) && (
        <div className="scene-context">
          {conversation && (
            <div className="conversation-summary">
              <div><b>{participantNames}</b> · {conversation.primaryTopic.summary}</div>
              <div className="context-meta">
                next: {expectedName ?? "open"} · {conversation.summary}
              </div>
            </div>
          )}
          {openRequests.length > 0 && (
            <div className="request-stack" aria-label="Open requests">
              {openRequests.map((request) => {
                const inbound = request.recipient === playerId;
                const otherId = inbound ? request.requester : request.recipient;
                const otherName = world.characters[otherId]?.name ?? otherId;
                const resolution = inbound
                  ? request.status === "accepted"
                    ? "Close with Help"
                    : "Close with Refuse or Help"
                  : "Closes when answered, fulfilled, or expired";
                return (
                  <div className="request-banner" key={request.id}>
                    <span className="request-label">Open request</span>
                    <span>
                      {inbound ? `${otherName} → You` : `You → ${otherName}`}: {request.subject}
                    </span>
                    <span className="request-state">{request.status} · {resolution}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="panel-body scene-history" ref={bodyRef}>
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
