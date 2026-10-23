"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

type Props = { value: number; format?: (n: number) => string; className?: string };

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Counts from the previous value to the new one, so a revised budget visibly moves. */
export function AnimatedNumber({ value, format = usd, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  const reduce = useReducedMotion();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduce) {
      node.textContent = format(value);
      previous.current = value;
      return;
    }
    const controls = animate(previous.current, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => { node.textContent = format(v); } });
    previous.current = value;
    return () => controls.stop();
  }, [value, format, reduce]);
  return <span ref={ref} className={className}>{format(value)}</span>;
}
