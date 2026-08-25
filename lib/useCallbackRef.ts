import { useRef } from "react";

export function useCallbackRef<T extends (...args: never[]) => unknown>(
  fn: T,
): { current: T } {
  const ref = useRef(fn);
  ref.current = fn;
  return ref;
}
