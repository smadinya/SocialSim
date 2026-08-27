import type {
  CharacterId,
  Move,
  RelationshipField,
  SimEvent,
  TickResult,
  WorldState,
} from "./viewTypes";

import { metaFor } from "./moveMeta";
import { formatClock } from "./clock";

export interface SceneLine {
  id: string;
  speaker: CharacterId;
  speakerName: string;
  text: string;
  streaming: boolean;
  optimistic: boolean;
}

export interface FeedItem {
  id: string;
  turn: number;
  text: string;
}

export type RevealStep =
  | { kind: "utterance"; speaker: CharacterId; speakerName: string; line: string }
  | { kind: "delta"; from: CharacterId; to: CharacterId; field: RelationshipField; after: number }
  | { kind: "feed"; event: SimEvent }
  /** The night pass, rendered once at the head of a new day. */
  | { kind: "digest"; events: SimEvent[] };

export interface RevealPlan {
  id: number;
  steps: RevealStep[];
}

export interface UiState {
  world: WorldState;
  playerId: CharacterId;
  selectedId: CharacterId;
  scene: SceneLine[];
  feed: FeedItem[];
  status: string;
  busy: boolean;
  understoodAs: string | null;
  /** false = the interpreter refused; the same slot renders as a warning. */
  understoodOk: boolean;
  pending: RevealPlan | null;
  revealCount: number;
}

export type Action =
  | { type: "select"; id: CharacterId }
  | { type: "beginTurn"; move: Move }
  | { type: "applyResult"; result: TickResult }
  | { type: "startLine"; speaker: CharacterId; speakerName: string }
  | { type: "streamText"; text: string }
  | { type: "finishLine" }
  | { type: "applyDelta"; from: CharacterId; to: CharacterId; field: RelationshipField; after: number }
  | { type: "addFeed"; event: SimEvent }
  | { type: "endReveal" }
  | { type: "understood"; text: string | null; ok: boolean }
  | { type: "setBusy"; busy: boolean }
  | { type: "replaceWorld"; world: WorldState; status: string };

export interface InitArgs {
  world: WorldState;
  playerId: CharacterId;
}

export function initState({ world, playerId }: InitArgs): UiState {
  const present = world.scene.presentCharacters;
  const firstOther = present.find((id) => id !== playerId) || playerId;

  return {
    world,
    playerId,
    selectedId: firstOther,
    scene: [
      {
        id: "line-intro",
        speaker: playerId,
        speakerName: world.characters[playerId]?.name || "You",
        text: `${formatClock(world.day, world.slot)}. You step into the ${
          world.locations[world.scene.location]?.name ?? world.scene.location
        }.`,
        streaming: false,
        optimistic: false,
      },
    ],
    feed: [],
    status: "Pick a move, or type a custom action.",
    busy: false,
    understoodAs: null,
    understoodOk: true,
    pending: null,
    revealCount: 0,
  };
}

function nameOf(world: WorldState, id?: CharacterId): string {
  if (!id) return "";
  return world.characters[id]?.name || id;
}

function stripOptimistic(scene: SceneLine[]): SceneLine[] {
  return scene.filter((line) => !line.optimistic);
}

function rollbackRelationships(
  target: WorldState,
  previous: WorldState,
): WorldState {
  const next = structuredClone(target);
  for (const id of Object.keys(next.characters)) {
    const prev = previous.characters[id];
    if (!prev) continue;
    next.characters[id].relationships = structuredClone(prev.relationships);
  }
  return next;
}

function buildPlan(
  result: TickResult,
  playerId: CharacterId,
  world: WorldState,
  id: number,
): RevealPlan {
  const steps: RevealStep[] = [];
  const utterancesLeft = [...result.utterances];
  // Deltas are *consumed*, not filtered. Filtering by `sourceActor` alone
  // attributed every delta a character caused this tick to the first move they
  // made — which was invisible while one conversation ran at a time and wrong
  // the moment two could.
  const deltasLeft = [...result.deltas];
  const eventsLeft = [...result.events];

  if (result.overnight && result.overnight.length > 0) {
    steps.push({ kind: "digest", events: result.overnight });
  }

  // Presence changes bracket the tick: you see someone walk in before they
  // start talking, and walk out after they've spoken.
  for (const event of result.events) {
    if (event.type === "arrival") steps.push({ kind: "feed", event });
  }

  for (const resolved of result.log) {
    const move = resolved.move;

    if (resolved.witnessedByPlayer) {
      const index = utterancesLeft.findIndex(
        (u) => u.speaker === move.actor && u.moveId === move.id,
      );
      if (index >= 0) {
        const utterance = utterancesLeft.splice(index, 1)[0];
        steps.push({
          kind: "utterance",
          speaker: utterance.speaker,
          speakerName: nameOf(world, utterance.speaker),
          line: utterance.line,
        });
      }
    } else {
      const at = eventsLeft.findIndex(
        (e) => e.actor === move.actor && e.type === "offscreen",
      );
      if (at >= 0) steps.push({ kind: "feed", event: eventsLeft.splice(at, 1)[0] });
    }

    for (let i = deltasLeft.length - 1; i >= 0; i--) {
      const delta = deltasLeft[i];
      if (delta.sourceActor !== move.actor) continue;
      if (delta.conversationId !== resolved.conversationId) continue;
      deltasLeft.splice(i, 1);
      steps.push({
        kind: "delta",
        from: delta.from,
        to: delta.to,
        field: delta.field,
        after: delta.after,
      });
    }
  }

  // Anything the engine produced outside a move — a lapsed request, a status
  // crossing, the ending. Without this they applied to the world silently and
  // the bars jumped with no line explaining why.
  for (const delta of deltasLeft) {
    steps.push({
      kind: "delta",
      from: delta.from,
      to: delta.to,
      field: delta.field,
      after: delta.after,
    });
  }

  for (const event of eventsLeft) {
    if (
      event.type === "departure" ||
      event.type === "lapsed" ||
      event.type === "status" ||
      event.type === "evidence" ||
      event.type === "awkward" ||
      event.type === "phase" ||
      event.type === "ending" ||
      event.type === "blocked"
    ) {
      steps.push({ kind: "feed", event });
    }
  }

  return { id, steps };
}

export function reducer(state: UiState, action: Action): UiState {
  switch (action.type) {
    case "select":
      return { ...state, selectedId: action.id };

    case "beginTurn": {
      const meta = metaFor(action.move.id);
      const targetName = nameOf(state.world, action.move.target);
      const label = meta.needsTarget
        ? `${meta.label} ${targetName}`
        : meta.label;

      const optimisticLine: SceneLine = {
        id: `opt-${Date.now()}`,
        speaker: state.playerId,
        speakerName: nameOf(state.world, state.playerId),
        text: `> ${label}`,
        streaming: false,
        optimistic: true,
      };

      return {
        ...state,
        busy: true,
        status: "Resolving turn…",
        scene: [...state.scene, optimisticLine],
        // It's about the text that was typed, so it goes stale the moment the
        // player does anything else. It used to sit pinned under the input
        // across every following menu move.
        understoodAs: null,
        understoodOk: true,
      };
    }

    case "applyResult": {
      const staged = rollbackRelationships(action.result.state, state.world);
      const plan = buildPlan(
        action.result,
        state.playerId,
        action.result.state,
        state.revealCount + 1,
      );

      return {
        ...state,
        world: staged,
        scene: stripOptimistic(state.scene),
        pending: plan,
        revealCount: state.revealCount + 1,
        status: "Watching it unfold…",
      };
    }

    case "startLine": {
      const line: SceneLine = {
        id: `line-${Date.now()}-${state.scene.length}`,
        speaker: action.speaker,
        speakerName: action.speakerName,
        text: "",
        streaming: true,
        optimistic: false,
      };
      return { ...state, scene: [...state.scene, line] };
    }

    case "streamText": {
      const scene = state.scene.slice();
      const last = scene[scene.length - 1];
      if (last && last.streaming) {
        scene[scene.length - 1] = { ...last, text: action.text };
      }
      return { ...state, scene };
    }

    case "finishLine": {
      const scene = state.scene.slice();
      const last = scene[scene.length - 1];
      if (last && last.streaming) {
        scene[scene.length - 1] = { ...last, streaming: false };
      }
      return { ...state, scene };
    }

    case "applyDelta": {
      const world = structuredClone(state.world);
      const rel = world.characters[action.from]?.relationships[action.to];
      if (rel) rel[action.field] = action.after;
      return { ...state, world };
    }

    case "addFeed": {
      const item: FeedItem = {
        id: action.event.id,
        turn: action.event.turn,
        text: action.event.description,
      };
      return { ...state, feed: [item, ...state.feed].slice(0, 30) };
    }

    case "endReveal":
      return {
        ...state,
        busy: false,
        status: "Your move.",
      };

    case "understood":
      return { ...state, understoodAs: action.text, understoodOk: action.ok };

    case "setBusy":
      return { ...state, busy: action.busy };

    case "replaceWorld":
      return {
        ...state,
        world: action.world,
        selectedId:
          action.world.scene.presentCharacters.find(
            (id) => id !== state.playerId,
          ) || state.playerId,
        scene: [
          {
            id: `line-reset-${Date.now()}`,
            speaker: state.playerId,
            speakerName: nameOf(action.world, state.playerId),
            text: `${formatClock(action.world.day, action.world.slot)}. You step into the ${
              action.world.locations[action.world.scene.location]?.name ??
              action.world.scene.location
            }.`,
            streaming: false,
            optimistic: false,
          },
        ],
        feed: [],
        understoodAs: null,
        understoodOk: true,
        pending: null,
        busy: false,
        status: action.status,
      };

    default:
      return state;
  }
}
