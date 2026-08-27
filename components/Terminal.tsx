"use client";

import { useCallbackRef } from "@/lib/useCallbackRef";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Move, MoveId, WorldFixture } from "@/lib/viewTypes";
import { initState, reducer } from "@/lib/reducer";
import type { MenuRow } from "@/lib/moveMeta";
import { MENU_MOVE_IDS, MENU_ROWS, canFight, metaFor } from "@/lib/moveMeta";
import { requestsFor, runTick } from "@/lib/mockEngine";
import { interpretInput } from "@/lib/interpret";
import { postInterpret, postTurn } from "@/lib/api";
import type { AiMode } from "@/lib/api";
import { MOVE_IDS } from "@sim/moves/catalog";
import { formatClock, movesLeft } from "@/lib/clock";
import { between, talkingPairs } from "@/lib/conversations";
import { topicsKnownTo } from "@/lib/topics";
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
import RelationshipMap from "./RelationshipMap";

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
  const [state, dispatch] = useReducer(reducer, { world, playerId }, initState);

  const [row, setRow] = useState<MenuRow>("Talk");
  const [selectedMove, setSelectedMove] = useState<MoveId>(MENU_MOVE_IDS.Talk[0]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [selectedExit, setSelectedExit] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [useServer, setUseServer] = useState(true);
  const [aiMode, setAiMode] = useState<AiMode | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  const w = state.world;
  const present = w.scene.presentCharacters;

  const targets = useMemo(
    () =>
      present
        .filter((id) => id !== playerId)
        .map((id) => ({ id, name: w.characters[id].name })),
    [present, playerId, w.characters],
  );

  const exits = useMemo(() => {
    const here = w.locations[w.scene.location];
    return (here?.connectsTo ?? []).map((id) => ({
      id,
      name: w.locations[id]?.name ?? id,
    }));
  }, [w.locations, w.scene.location]);

  const topics = useMemo(
    () =>
      topicsKnownTo(w, playerId).map((id) => ({
        id,
        name: w.topics[id].label,
      })),
    [w, playerId],
  );

  const requests = useMemo(() => requestsFor(w, playerId), [w, playerId]);
  const pairs = useMemo(() => talkingPairs(w, w.scene.location), [w]);

  const fightUnlocked = useMemo(() => {
    if (!selectedTarget) return false;
    const conversation = between(w, playerId, selectedTarget);
    return canFight(w, playerId, selectedTarget, conversation?.heat ?? 0);
  }, [w, playerId, selectedTarget]);

  useEffect(() => {
    if (selectedTarget === null && targets.length > 0) setSelectedTarget(targets[0].id);
  }, [selectedTarget, targets]);
  useEffect(() => {
    if (selectedExit === null && exits.length > 0) setSelectedExit(exits[0].id);
  }, [selectedExit, exits]);
  useEffect(() => {
    if (selectedTopic === null && topics.length > 0) setSelectedTopic(topics[0].id);
  }, [selectedTopic, topics]);

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
        } else if (step.kind === "digest") {
          for (const event of step.events) {
            if (cancelled) return;
            dispatch({ type: "addFeed", event });
            await sleep(reduce ? 0 : 200);
          }
        }
      }
      if (!cancelled) dispatch({ type: "endReveal" });
    })();

    return () => {
      cancelled = true;
    };
  }, [state.pending]);

  async function performMove(move: Move) {
    dispatch({ type: "beginTurn", move });
    const snapshot = stateRef.current.world;
    try {
      if (useServer) {
        const { result, mode } = await postTurn(snapshot, playerId, move);
        setAiMode(mode);
        dispatch({ type: "applyResult", result });
      } else {
        dispatch({ type: "applyResult", result: runTick(snapshot, playerId, move) });
      }
    } catch {
      setAiMode("mock");
      dispatch({ type: "applyResult", result: runTick(snapshot, playerId, move) });
    }
  }

  function commit() {
    if (stateRef.current.busy) return;
    const meta = metaFor(selectedMove);

    if (selectedMove === "GoTo") {
      if (!selectedExit) return;
      performMove({ id: "GoTo", actor: playerId, args: { location: selectedExit } });
      return;
    }
    if (meta.needsTarget && !selectedTarget) return;

    const move: Move = {
      id: selectedMove,
      actor: playerId,
      target: meta.needsTarget ? selectedTarget || undefined : undefined,
    };
    if (meta.needsTopic && selectedTopic) move.args = { topicId: selectedTopic };
    performMove(move);
  }

  function respond(moveId: MoveId, asker: string) {
    if (stateRef.current.busy) return;
    performMove({ id: moveId, actor: playerId, target: asker });
  }

  function selectMove(id: MoveId) {
    setSelectedMove(id);
    if (metaFor(id).needsTarget && !selectedTarget && targets.length > 0) {
      setSelectedTarget(targets[0].id);
    }
  }

  function selectRow(next: MenuRow) {
    setRow(next);
    setSelectedMove(MENU_MOVE_IDS[next][0]);
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
  const selectMoveRef = useCallbackRef(selectMove);
  const selectRowRef = useCallbackRef(selectRow);
  const rowRef = useRef(row);
  rowRef.current = row;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const tag = el ? el.tagName : "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (stateRef.current.busy) return;

      // Number keys address the OPEN ROW, not a flat list. The catalog passed
      // ten moves in this update and a flat list would have made the tenth
      // permanently unreachable.
      if (e.key >= "1" && e.key <= "9") {
        const ids = MENU_MOVE_IDS[rowRef.current];
        const idx = parseInt(e.key, 10) - 1;
        if (idx < ids.length) {
          e.preventDefault();
          selectMoveRef.current(ids[idx]);
        }
      } else if (e.key === "Tab") {
        e.preventDefault();
        const at = MENU_ROWS.indexOf(rowRef.current);
        selectRowRef.current(MENU_ROWS[(at + (e.shiftKey ? -1 : 1) + MENU_ROWS.length) % MENU_ROWS.length]);
      } else if (e.key === "Enter") {
        e.preventDefault();
        commitRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commitRef, selectMoveRef, selectRowRef]);

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
      const parsed = parseImported(String(reader.result));
      if (parsed) {
        dispatch({ type: "replaceWorld", world: parsed, status: "Imported." });
      } else {
        dispatch({ type: "understood", text: "That save is from an older build.", ok: false });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const left = movesLeft(w.slot);

  return (
    <>
      <div className="crt" />
      <div className="shell">
        <header className="status">
          <span className="title glow">SOCIALSIM</span>
          <span className="field">
            <b>{formatClock(w.day, w.slot)}</b>
          </span>
          <span className={`field ${left <= 4 ? "urgent" : ""}`}>
            <b>{left}</b> moves left
          </span>
          <span className="daybar" aria-hidden>
            <span className="daybar-fill" style={{ width: `${(left / 24) * 100}%` }} />
          </span>
          <span className="field">{state.status}</span>
          <span className="spacer" />
          <button onClick={() => setShowMap((v) => !v)}>who&apos;s who</button>
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

        <SceneView
          scene={state.scene}
          world={state.world}
          playerId={playerId}
          pairs={pairs}
        />

        <ActionMenu
          row={row}
          onSelectRow={selectRow}
          moves={MENU_MOVE_IDS[row]}
          selectedMove={selectedMove}
          onSelectMove={selectMove}
          targets={targets}
          selectedTarget={selectedTarget}
          onSelectTarget={setSelectedTarget}
          exits={exits}
          selectedExit={selectedExit}
          onSelectExit={setSelectedExit}
          topics={topics}
          selectedTopic={selectedTopic}
          onSelectTopic={setSelectedTopic}
          requests={requests}
          nameOf={(id) => w.characters[id]?.name ?? id}
          turn={w.turn}
          onRespond={respond}
          fightUnlocked={fightUnlocked}
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

      {showMap && (
        <RelationshipMap
          world={state.world}
          onPick={(id) => {
            dispatch({ type: "select", id });
            setShowMap(false);
          }}
          onClose={() => setShowMap(false)}
        />
      )}
    </>
  );
}
