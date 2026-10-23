"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import type { GlobeProps } from "./HeroGlobe";

const HeroGlobe = dynamic(() => import("./HeroGlobe"), { ssr: false });

type Props = Omit<GlobeProps, "onUnavailable" | "onReady">;

/** Static poster: same composition as the 3D globe, shown while it loads and whenever WebGL is unavailable. */
function GlobePoster({ isHidden }: { isHidden: boolean }) {
  return (
    <div className="absolute inset-0 transition-opacity duration-1000" style={{ opacity: isHidden ? 0 : 1 }} aria-hidden>
      <div
        className="absolute right-[-18%] top-1/2 aspect-square w-[min(92vw,820px)] -translate-y-1/2 rounded-full lg:right-[2%]"
        style={{
          background:
            "radial-gradient(circle at 36% 32%, rgba(160,147,255,0.22), rgba(11,13,22,0.9) 55%), repeating-radial-gradient(circle at 50% 50%, rgba(159,176,255,0.12) 0 1px, transparent 1px 22px)",
          boxShadow: "0 0 120px -10px rgba(108,92,231,0.55), inset 0 0 80px rgba(6,7,12,0.9)",
        }}
      />
    </div>
  );
}

/** Lightweight 3D globe with a graceful poster fallback; the page never depends on WebGL. */
export function GlobeStage(props: Props) {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const onUnavailable = useCallback(() => setFailed(true), []);
  const onReady = useCallback(() => setReady(true), []);
  return (
    <div className="absolute inset-0 overflow-hidden">
      <GlobePoster isHidden={ready} />
      {!failed && <HeroGlobe {...props} onUnavailable={onUnavailable} onReady={onReady} />}
    </div>
  );
}
