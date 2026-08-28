"use client";

import { useCallbackRef } from "@/lib/useCallbackRef";
import { useEffect, useReducer, useRef, useState } from "react";
import type { Move, MoveId, WorldFixture } from "@/lib/viewTypes";
import { initState, reducer } from "@/lib/reducer";
import { MENU_MOVE_IDS, metaFor } from "@/lib/moveMeta";
import { runSimTick } from "@/lib/simEngine";
import { interpretInput } from "@/lib/interpret";
import { postInterpret, postTurn } from "@/lib/api";
import type { AiMode } from "@/lib/api";
import { MOVE_IDS } from "@sim/moves/catalog";
import { linkMoveToPlayerRequest } from "@/lib/requestMoves";
import {
  clearSession,
  exportSession,
  loadSession,
  parseImported,
  saveSession,
} from "@/lib/save";

import SceneView from "./SceneView";
import ActionMenu from "./ActionMenu";
import CharacterInspector from "./CharacterInspector";
import EventFeed from "./EventFeed";

const LEGAL_IDS = [...MOVE_IDS] as MoveId[];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prefersReduced(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface Props {
  fixture: WorldFixture;
}

export default function Terminal({ fixture }: Props) {
  const { playerId, ...world } = fixture;
  const [state, dispatch] = useReducer(

    reducer,
    { world, playerId },
    initState,
  );

  const [selectedMove, setSelectedMove] = useState<MoveId>(MENU_MOVE_IDS[0]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  // On by default: `performMove` and `handleCustom` both catch and re-run the
  // tick locally, so a missing key or a dead network degrades on its own. Off
  // by default meant a first-time player only ever saw stub templates.
  const [useServer, setUseServer] = useState(true);
  const [aiMode, setAiMode] = useState<AiMode | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  const present = state.world.scene.presentCharacters;
  // Player-targeted moves are submitted with `interruptConversation: true`
  // by runSimTick. Filtering through generic NPC legality here hid characters
  // who were already talking, even though the engine permits that interruption.
  const actionMoves = present.includes(playerId) ? MENU_MOVE_IDS : [];
  const targets = present
    .filter((id) => id !== playerId)
    .map((id) => ({ id, name: state.world.characters[id].name }));

  useEffect(() => {
    if (actionMoves.length > 0 && !actionMoves.includes(selectedMove)) {
      setSelectedMove(actionMoves[0]);
    }
  }, [actionMoves, selectedMove]);

  useEffect(() => {
    if (metaFor(selectedMove).needsTarget) {
      if (!targets.some((target) => target.id === selectedTarget)) {
        setSelectedTarget(targets[0]?.id ?? null);
      }
    }
  }, [selectedMove, selectedTarget, targets]);

  // No autosave: it wrote the manual slot on every state change and nothing
  // read it at boot (`initState` always takes the fixture), so its only
  // observable effect was that `load` returned the state you were already in.
  // Resume-on-boot needs a separate key, and nobody has asked for it.

  useEffect(() => {
    const plan = state.pending;
    if (!plan) return;

    let cancelled = false;
    const reduce = prefersReduced();

    (async () => {
      for (const step of plan.steps) {
        if (cancelled) return;

        if (step.kind === "utterance") {
          dispatch({
            type: "startLine",
            speaker: step.speaker,
            speakerName: step.speakerName,
          });
          if (reduce) {
            dispatch({ type: "streamText", text: step.line });
          } else {
            for (let i = 1; i <= step.line.length; i++) {
              if (cancelled) return;
              dispatch({ type: "streamText", text: step.line.slice(0, i) });
              await sleep(30);
            }
          }
          dispatch({ type: "finishLine" });
          await sleep(140);
        } else if (step.kind === "delta") {
          dispatch({
            type: "applyDelta",
            from: step.from,
            to: step.to,
            field: step.field,
            after: step.after,
          });
          await sleep(reduce ? 0 : 500);
        } else if (step.kind === "feed") {
          dispatch({ type: "addFeed", event: step.event });
          await sleep(reduce ? 0 : 280);
        }
      }
      if (!cancelled) dispatch({ type: "endReveal" });
    })();

    return () => {
      cancelled = true;
    };
  }, [state.pending]);

  async function performMove(move: Move) {
    const snapshot = stateRef.current.world;
    const linkedMove = linkMoveToPlayerRequest(move, snapshot, playerId);
    dispatch({ type: "beginTurn", move: linkedMove });
    try {
      if (useServer) {
        const { result, mode } = await postTurn(snapshot, playerId, linkedMove);
        setAiMode(mode);
        dispatch({ type: "applyResult", result });
      } else {
        dispatch({ type: "applyResult", result: runSimTick(snapshot, playerId, linkedMove) });
      }
    } catch {
      setAiMode("mock");
      try {
        const result = runSimTick(snapshot, playerId, linkedMove);
        dispatch({ type: "applyResult", result });
      } catch (error) {
        dispatch({
          type: "understood",
          text: error instanceof Error ? error.message : "That move is not legal right now.",
          ok: false,
        });
        dispatch({ type: "setBusy", busy: false });
      }
    }
  }

  function commit() {
    if (stateRef.current.busy) return;
    const meta = metaFor(selectedMove);
    if (meta.needsTarget && !selectedTarget) return;
    const move: Move = {
      id: selectedMove,
      actor: playerId,
      target: meta.needsTarget ? selectedTarget || undefined : undefined,
    };
    performMove(move);
  }

  function selectMove(id: MoveId) {
    setSelectedMove(id);
    if (metaFor(id).needsTarget && !selectedTarget && targets.length > 0) {
      setSelectedTarget(targets[0].id);
    }
  }

  async function handleCustom(text: string) {
    if (stateRef.current.busy) return;
    dispatch({ type: "setBusy", busy: true });
    const snapshot = stateRef.current.world;

    let result;
    try {
      result = useServer
        ? await postInterpret(text, playerId, LEGAL_IDS, snapshot)
        : interpretInput(text, playerId, LEGAL_IDS, snapshot);
    } catch {
      result = interpretInput(text, playerId, LEGAL_IDS, snapshot);
    }

    dispatch({ type: "understood", text: result.understoodAs, ok: result.ok });

    if (result.ok) {
      await sleep(520);
      await performMove(result.move);
    } else {
      dispatch({ type: "setBusy", busy: false });
    }
  }

  const commitRef = useCallbackRef(commit);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const tag = el ? el.tagName : "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (stateRef.current.busy) return;

      if (e.key === "Enter") {
        e.preventDefault();
        commitRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commitRef]);

  function doLoad() {
    const loaded = loadSession();
    if (loaded) {
      dispatch({ type: "replaceWorld", world: loaded, status: "Loaded." });
    } else {
      dispatch({ type: "setBusy", busy: false });
    }
  }

  function doReset() {
    clearSession();
    dispatch({ type: "replaceWorld", world, status: "Reset to start." });
  }

  const fileRef = useRef<HTMLInputElement | null>(null);

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseImported( String(reader.result));
      if (parsed) {
        dispatch({ type: "replaceWorld", world: parsed, status: "Imported." });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <>
      <div className="crt" />
      <div className="shell">
        <header className="status">
          <span className="title glow">SOCIALSIM</span>
          <span className="field">
            <b>{state.world.clock}</b>
          </span>
          <span className="field">
            turn <b>{state.world.turn}</b>
          </span>
          <span className="field">{state.status}</span>
          <span className="spacer" />
          <button onClick={() => setUseServer((v) => !v)}>
            server: {useServer ? "on" : "off"}
            {useServer && aiMode === "mock" ? " (stub)" : ""}
          </button>
          <button onClick={() => saveSession(state.world)}>save</button>
          <button onClick={doLoad}>load</button>
          <button onClick={() => exportSession(state.world)}>export</button>
          <button onClick={() => fileRef.current?.click()}>import</button>
          <button onClick={doReset}>reset</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={onImportFile}
          />
        </header>

        <SceneView scene={state.scene} world={state.world} playerId={playerId} />

        <ActionMenu
          moves={actionMoves}
          selectedMove={selectedMove}
          onSelectMove={selectMove}
          targets={targets}
          selectedTarget={selectedTarget}
          onSelectTarget={setSelectedTarget}
          onCommit={commit}
          busy={state.busy}
          understoodAs={state.understoodAs}
          understoodOk={state.understoodOk}
          onCustom={handleCustom}
        />

        <CharacterInspector
          world={state.world}
          selectedId={state.selectedId}
          playerId={playerId}
          onSelect={(id) => dispatch({ type: "select", id })}
        />

        <EventFeed feed={state.feed} />
      </div>
    </>
  );
}
