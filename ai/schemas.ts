import { z } from "zod";

/**
 * The `responseSchema` guarantees shape. These guarantee sense — every model
 * output passes one of them before it reaches the engine.
 */

export const RealizedLineSchema = z.object({
  line: z.string().trim().min(1).max(400),
  deliveryNote: z.string().trim().max(200).optional(),
});

export const InterpretedMoveSchema = z.object({
  move: z.string().min(1),
  /** Who is addressed. */
  target: z.string().optional(),
  /**
   * Who is *talked about* — the "Bob" in "tell Alice about Bob". Three-party
   * moves only, and never the same person as `target`. May be off scene: the
   * subject is discussed, not addressed.
   */
  subject: z.string().optional(),
  /** Tone hint for realization. Never scales a delta. */
  intensity: z.number().min(0).max(1).optional(),
  /**
   * How confident the model is that this text is a move at all. Below
   * `MIN_CONFIDENCE` the input is refused instead of force-fitted, which is
   * what made "asdfkjh qwerty" execute a `Withdraw` and burn a turn.
   */
  confidence: z.number().min(0).max(1).optional(),
});

/** Below this we say we didn't follow it rather than guess. */
export const MIN_CONFIDENCE = 0.4;

export type RealizedLineOutput = z.infer<typeof RealizedLineSchema>;
export type InterpretedMoveOutput = z.infer<typeof InterpretedMoveSchema>;
