import type { ReactNode } from "react";

type Props = { id: string; eyebrow: string; title: ReactNode; children?: ReactNode };

export function SectionHead({ id, eyebrow, title, children }: Props) {
  return (
    <header id={id} className="mb-8 scroll-mt-24 sm:mb-10">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="display mt-3 text-4xl leading-[1.05] sm:text-5xl">{title}</h2>
      {children && <p className="mt-4 max-w-2xl text-[0.95rem] leading-relaxed text-bone-dim">{children}</p>}
    </header>
  );
}
