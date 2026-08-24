"use client";

import { useEffect, useRef, useState } from "react";
import type { RelationshipField } from "@/lib/viewTypes";

interface Props {
  field: RelationshipField;
  value: number;
}

export default function TrustBar({ field, value }: Props) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = fromRef.current;
    const end = value;
    if (start === end) {
      setShown(end);
      return;
    }

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      fromRef.current = end;
      setShown(end);
      return;
    }

    const duration = 480;
    const t0 = performance.now();

    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const current = Math.round(start + (end - start) * eased);
      setShown(current);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = end;
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  const fillClass =
    field === "fear" ? "fear" : shown >= 70 ? "high" : "";

  return (
    <div className="rel-bars">
      <span className="field">{field}</span>
      <span className="bar-track">
        <span
          className={`bar-fill ${fillClass}`}
          style={{ width: `${shown}%` }}
        />
      </span>
      <span className="bar-num">{shown}</span>
    </div>
  );
}
