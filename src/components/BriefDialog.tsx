"use client";

import { useEffect, useRef } from "react";

import type { AgentInput } from "@/lib/agent/agent";
import { BriefForm } from "./BriefForm";

type Props = { initial: AgentInput; onSubmit: (input: AgentInput) => void; onCancel: () => void };

/**
 * Native modal dialog: focus trap and Escape come from the platform. The parent owns open/closed state,
 * so the dialog never reports its own `close` event (StrictMode re-runs the effect, which closes it once).
 */
export function BriefDialog({ initial, onSubmit, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onCancel(); }} aria-label="Film brief" className="m-auto w-[min(720px,calc(100vw-2rem))] max-h-[92svh] overflow-auto rounded-3xl border border-line-2 bg-transparent p-0 text-bone">
      <BriefForm initial={initial} onSubmit={onSubmit} onCancel={onCancel} />
    </dialog>
  );
}
