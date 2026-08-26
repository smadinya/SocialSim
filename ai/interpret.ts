import type { CharacterId, MoveId, WorldState } from "@ai/types";
import type { InterpretResult, Move } from "@/lib/viewTypes";
import { interpretPrompt, interpretResponseSchema } from "@ai/prompts/interpret";
import { generateJson, mockMode } from "@ai/client";
import { InterpretedMoveSchema, MIN_CONFIDENCE } from "@ai/schemas";
import { THREE_PARTY_MOVES, interpretInput } from "@/lib/interpret";
import { metaFor } from "@/lib/moveMeta";

/**
 * Free text in, a legal `Move` out.
 *
 * The `InterpretResult` shape is Track C's contract — `understoodAs` renders in
 * their confirmation line and `ok` drives the disabled-spinner state. Do not
 * change it from in here.
 *
 * `legal` comes from `getLegalMoves`, built off `MOVE_IDS` in
 * `sim/src/moves/catalog.ts`. That array was missing `Propose` and `Wait`, so
 * neither could be produced by either path — fixed in the catalog, not worked
 * around here.
 */
/**
 * The one character the player named, if every character they named is absent.
 * Returns null when nobody is named, or when at least one named person is here.
 */
function absentlyNamed(
  input: string,
  actor: CharacterId,
  world: WorldState,
): CharacterId | null {
  const named = Object.keys(world.characters).filter(
    (id) =>
      id !== actor &&
      new RegExp(`\\b(${id}|${world.characters[id].name})\\b`, "i").test(input),
  );
  if (named.length === 0) return null;
  if (named.some((id) => world.scene.presentCharacters.includes(id))) return null;
  return named[0];
}

export async function interpret(
  input: string,
  actor: CharacterId,
  legal: MoveId[],
  world: WorldState,
): Promise<InterpretResult> {
  // If everyone the player named has left the scene, say so and stop. This
  // runs ahead of both paths on purpose:
  //   - the keyword table happily targets someone who isn't there;
  //   - the model can't target them (the enum only offers present characters)
  //     so it picks something else entirely — "confront bob" came back as
  //     Withdraw and executed silently, which is worse than a refusal.
  // Naming an absent character alongside a present one ("tell dana about bob")
  // is fine and falls through.
  const absent = absentlyNamed(input, actor, world);
  if (absent) {
    return {
      move: { id: "Withdraw", actor },
      understoodAs: `${world.characters[absent].name} isn't here.`,
      ok: false,
    };
  }

  // Last guard, applied to whatever either path returns: never execute a move
  // aimed at someone who isn't in the scene. The keyword table picks the first
  // name it sees, so "tell dana about bob" comes back aimed at Bob.
  const refuseAbsentTarget = (result: InterpretResult): InterpretResult => {
    const target = result.move.target;
    if (result.ok && target && !world.scene.presentCharacters.includes(target)) {
      return {
        move: result.move,
        understoodAs: `${world.characters[target]?.name ?? target} isn't here.`,
        ok: false,
      };
    }
    return result;
  };

  // The keyword table is the fallback, not a second implementation: it already
  // produces the `understoodAs` string and the "not sure" branch.
  const keyword = (): InterpretResult =>
    refuseAbsentTarget(interpretInput(input, actor, legal, world));
  if (mockMode()) return keyword();

  const targets = world.scene.presentCharacters
    .filter((id) => id !== actor && world.characters[id])
    .map((id) => ({ id, name: world.characters[id].name }));

  // A subject is talked about, not addressed, so the whole cast qualifies —
  // "warn Alice about Bob" is the point of the field and Bob is never here.
  const cast = Object.keys(world.characters)
    .filter((id) => id !== actor)
    .map((id) => ({ id, name: world.characters[id].name }));

  try {
    const raw = await generateJson(
      interpretPrompt({
        input,
        actorName: world.characters[actor]?.name ?? actor,
        legal,
        targets,
        cast,
      }),
      interpretResponseSchema(
        legal,
        targets.map((t) => t.id),
        cast.map((c) => c.id),
      ),
    );
    const parsed = InterpretedMoveSchema.safeParse(raw);
    if (!parsed.success) return keyword();

    // The enum guarantees a valid move id for any input at all, including
    // gibberish — so the model says "I couldn't read that" through
    // `confidence`, not through the move. Refusing here costs no turn;
    // `handleCustom` renders `ok: false` and stops.
    if ((parsed.data.confidence ?? 1) < MIN_CONFIDENCE) {
      return {
        move: { id: "Withdraw", actor },
        understoodAs: "I didn't follow that — try naming an action and a character.",
        ok: false,
      };
    }

    // The enum should make this impossible. Check anyway — the schema
    // guarantees shape, not sense.
    const moveId = parsed.data.move as MoveId;
    if (!legal.includes(moveId)) return keyword();

    const meta = metaFor(moveId);
    const target = targets.find((t) => t.id === parsed.data.target)?.id;
    const move: Move = { id: moveId, actor, target };

    // `Move.args` is already typed and unused; the engine doesn't read
    // `subject` yet, so warning Alice about Bob still moves nothing of Bob's.
    // That's a missing effect, not a wrong one — the line the speaker says is
    // about the right person, which is the whole player-facing complaint.
    // ponytail: Track A's ask — `args.subject` vs a `subject` on `MoveEffect`.
    const subject = cast.find((c) => c.id === parsed.data.subject)?.id;
    const named =
      subject && subject !== target && THREE_PARTY_MOVES.includes(moveId)
        ? subject
        : undefined;
    if (named) move.args = { subject: named };

    if (meta.needsTarget && !target) {
      return {
        move,
        understoodAs: `${meta.label} — but on whom? Name a character.`,
        ok: false,
      };
    }

    const about = named ? ` about ${world.characters[named].name}` : "";
    return refuseAbsentTarget({
      move,
      understoodAs: meta.needsTarget
        ? `${meta.label} ${targets.find((t) => t.id === target)?.name ?? ""}${about}`.trim()
        : meta.label,
      ok: true,
    });
  } catch {
    return keyword();
  }
}
