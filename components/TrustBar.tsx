"use client";

import { useEffect, useRef, useState } from "react";
import type { RelationshipField } from "@/lib/viewTypes";

interface Props {
  field: RelationshipField;
  value: number;
}

/** The axes you do not want high. They read as a warning at any value. */
const NEGATIVE_AXES: RelationshipField[] = ["fear", "anger", "jealousy", "hate"];

export default function TrustBar({ field, value }: Props) {
  const [shown, setShown] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(value);
      return;
    }
    let frame = 0;
    const from = shown;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 320);
      setShown(Math.round(from + (value - from) * t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const fillClass = NEGATIVE_AXES.includes(field)
    ? "negative"
    : shown >= 70
      ? "high"
      : "";

  return (
    <div className="bar-row">
      <span className="bar-label">{field}</span>
      <span className="bar-track">
        <span className={`bar-fill ${fillClass}`} style={{ width: `${shown}%` }} />
      </span>
      <span className="bar-value">{shown}</span>
    </div>
  );
}
