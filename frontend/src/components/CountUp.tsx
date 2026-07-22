"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  value: number | null | undefined;
  /** Formatter for the displayed number — currency symbol, thousands, etc. */
  format?: (v: number) => string;
  /** Placeholder when there is no value to count to. */
  placeholder?: string;
  durationMs?: number;
  className?: string;
}

/**
 * Counts a figure up to its real value on mount, and re-runs whenever the
 * value changes — so switching condition tabs re-animates to the new price
 * rather than snapping.
 *
 * The animation is strictly an enhancement: requestAnimationFrame does not
 * fire in a hidden or backgrounded tab, so a timer guarantees the number
 * lands on its true value regardless. Without that, a value that changed
 * while the tab was hidden would keep rendering the previous price — a
 * correctness bug, not just a missing animation. Reduced-motion and
 * already-hidden documents skip straight to the value.
 */
export default function CountUp({
  value,
  format = (v) => v.toLocaleString("en-US"),
  placeholder = "--",
  durationMs = 750,
  className,
}: Props) {
  const [shown, setShown] = useState<number | null>(value ?? null);
  const frame = useRef<number | null>(null);
  const from = useRef<number>(0);

  useEffect(() => {
    if (value == null) {
      setShown(null);
      return;
    }

    const skip =
      typeof window === "undefined" ||
      document.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (skip) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = performance.now();
    const a = from.current;
    const b = value;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // cubic ease-out

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setShown(a + (b - a) * ease(t));
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else from.current = b;
    };
    frame.current = requestAnimationFrame(tick);

    // Safety net for throttled/hidden tabs where the frames never arrive.
    const land = window.setTimeout(() => {
      setShown(b);
      from.current = b;
    }, durationMs + 120);

    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      window.clearTimeout(land);
      from.current = value;
    };
  }, [value, durationMs]);

  if (shown == null) return <span className={className}>{placeholder}</span>;
  return <span className={className}>{format(Math.round(shown))}</span>;
}
