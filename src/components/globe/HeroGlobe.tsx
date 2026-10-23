"use client";

import { useEffect, useRef } from "react";
import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, Group, Line, LineBasicMaterial, MathUtils, Mesh,
  MeshBasicMaterial, PerspectiveCamera, Points, QuadraticBezierCurve3, RingGeometry, Scene, ShaderMaterial, SphereGeometry,
  Vector3, WebGLRenderer,
} from "three";

import { MARKET_GEO } from "@/lib/territory/market-geo";
import { landDots, toVec3 } from "./land-dots";

export interface GlobeProps {
  /** Markets under consideration (faint). */
  candidates: string[];
  /** Markets currently being researched (teal pulse). */
  pending: string[];
  /** Markets in the plan (violet, arcs between them). */
  plan: string[];
  onUnavailable: () => void;
  onReady: () => void;
}

type MarkerState = "off" | "candidate" | "pending" | "plan";

type Palette = Record<Exclude<MarkerState, "off">, string>;

/** Reads a colour token from :root so the WebGL scene uses the same palette as the page. */
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const ARC_POINTS = 56;
const MAX_ARCS = 10;
const CAMERA_Z = 5.4;
const DOT_SIZE = 13;
const DEFAULT_LNG = 10;

const DOT_VERT = `
uniform float uSize; uniform float uPixelRatio; varying float vFacing;
void main(){
  vec4 world = modelMatrix * vec4(position, 1.0);
  vFacing = dot(normalize(mat3(modelMatrix) * position), normalize(cameraPosition - world.xyz));
  vec4 mv = viewMatrix * world;
  gl_PointSize = uSize * uPixelRatio / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const DOT_FRAG = `
uniform vec3 uColor; varying float vFacing;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(uColor, smoothstep(0.0, 0.3, vFacing) * 1.0 * (1.0 - d));
}`;
const GLOW_VERT = `varying vec3 vNormal; void main(){ vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// Back faces of a slightly larger sphere: brightest where they meet the globe's edge, fading outward.
const GLOW_FRAG = `uniform vec3 uHalo; varying vec3 vNormal; void main(){ float t = clamp(-vNormal.z / 0.5, 0.0, 1.0); float i = pow(t, 3.0) * 0.5; gl_FragColor = vec4(uHalo, i); }`;
const CORE_FRAG = `uniform vec3 uCore; uniform vec3 uRim; varying vec3 vNormal; void main(){ float rim = pow(1.0 - max(0.0, vNormal.z), 3.5); gl_FragColor = vec4(mix(uCore, uRim, rim * 0.8), 1.0); }`;

/** Circular mean of longitudes, so Tokyo and Los Angeles average to the Pacific rather than Europe. */
function meanLng(codes: string[]): number | null {
  const pts = codes.map((c) => MARKET_GEO[c]).filter(Boolean);
  if (!pts.length) return null;
  const x = pts.reduce((s, [lng]) => s + Math.cos(MathUtils.degToRad(lng)), 0);
  const y = pts.reduce((s, [lng]) => s + Math.sin(MathUtils.degToRad(lng)), 0);
  return MathUtils.radToDeg(Math.atan2(y, x));
}

function arcPairs(codes: string[]): Array<[string, string]> {
  const sorted = codes.filter((c) => MARKET_GEO[c]).sort((a, b) => MARKET_GEO[a][0] - MARKET_GEO[b][0]);
  return sorted.slice(0, -1).map((c, i): [string, string] => [c, sorted[i + 1]]).slice(0, MAX_ARCS);
}

function makeArc(a: string, b: string, color: string): Line {
  const from = new Vector3(...toVec3(...MARKET_GEO[a]));
  const to = new Vector3(...toVec3(...MARKET_GEO[b]));
  const lift = 1 + from.distanceTo(to) * 0.32;
  const mid = from.clone().add(to).multiplyScalar(0.5).normalize().multiplyScalar(lift);
  const geometry = new BufferGeometry().setFromPoints(new QuadraticBezierCurve3(from, mid, to).getPoints(ARC_POINTS - 1));
  const material = new LineBasicMaterial({ color, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false });
  return new Line(geometry, material);
}

function disposeTree(root: Group | Scene) {
  root.traverse((o) => {
    const obj = o as Mesh;
    obj.geometry?.dispose();
    const m = obj.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m?.dispose();
  });
}

export default function HeroGlobe({ candidates, pending, plan, onUnavailable, onReady }: GlobeProps) {
  const mount = useRef<HTMLDivElement>(null);
  const state = useRef({ candidates, pending, plan });
  const apply = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onUnavailable, onReady });

  useEffect(() => {
    callbacks.current = { onUnavailable, onReady };
  }, [onUnavailable, onReady]);

  useEffect(() => {
    state.current = { candidates, pending, plan };
    apply.current?.();
  }, [candidates, pending, plan]);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      callbacks.current.onUnavailable();
      return;
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const compact = window.innerWidth < 640;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 1.75);
    renderer.setPixelRatio(pixelRatio);
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block";

    const palette: Palette = { candidate: token("--globe-candidate"), pending: token("--evidence"), plan: token("--accent") };
    const scene = new Scene();
    const camera = new PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(0, 0, CAMERA_Z);
    const globe = new Group();
    scene.add(globe);

    globe.add(new Mesh(new SphereGeometry(0.985, 48, 32), new ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: CORE_FRAG, uniforms: { uCore: { value: new Color(token("--globe-core")) }, uRim: { value: new Color(token("--globe-rim")) } } })));
    const dots = new BufferGeometry();
    dots.setAttribute("position", new BufferAttribute(landDots(compact ? 2.6 : 2), 3));
    globe.add(new Points(dots, new ShaderMaterial({
      vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, transparent: true, depthWrite: false,
      uniforms: { uColor: { value: new Color(token("--globe-dots")) }, uSize: { value: DOT_SIZE }, uPixelRatio: { value: pixelRatio } },
    })));
    globe.add(new Mesh(new SphereGeometry(1.14, 48, 32), new ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { uHalo: { value: new Color(token("--globe-halo")) } }, side: BackSide, blending: AdditiveBlending, transparent: true, depthWrite: false })));

    const markers = Object.entries(MARKET_GEO).map(([code, [lng, lat]]) => {
      const group = new Group();
      const pos = new Vector3(...toVec3(lng, lat, 1.004));
      group.position.copy(pos);
      group.lookAt(pos.clone().multiplyScalar(2));
      const dot = new Mesh(new SphereGeometry(0.015, 12, 8), new MeshBasicMaterial({ color: palette.candidate }));
      const ring = new Mesh(new RingGeometry(0.02, 0.026, 40), new MeshBasicMaterial({ color: palette.candidate, transparent: true, side: 2, depthWrite: false }));
      group.add(dot, ring);
      group.visible = false;
      globe.add(group);
      return { code, group, dot, ring, state: "off" as MarkerState, phase: (code.charCodeAt(0) * 0.137) % 1 };
    });

    let arcs: Line[] = [];
    let focusLng: number | null = null;
    let yaw = MathUtils.degToRad(-DEFAULT_LNG);
    const pointer = { x: 0, y: 0, sx: 0, sy: 0 };

    apply.current = () => {
      const { candidates: cand, pending: pend, plan: sel } = state.current;
      for (const m of markers) {
        m.state = sel.includes(m.code) ? "plan" : pend.includes(m.code) ? "pending" : cand.includes(m.code) ? "candidate" : "off";
        m.group.visible = m.state !== "off";
        if (m.state === "off") continue;
        const color = palette[m.state];
        (m.dot.material as MeshBasicMaterial).color.set(color);
        (m.ring.material as MeshBasicMaterial).color.set(color);
        m.dot.scale.setScalar(m.state === "plan" ? 1.7 : 1);
      }
      arcs.forEach((a) => { globe.remove(a); a.geometry.dispose(); (a.material as LineBasicMaterial).dispose(); });
      const arcCodes = sel.length >= 2 ? sel : cand;
      arcs = arcPairs(arcCodes).map(([a, b]) => makeArc(a, b, sel.length >= 2 ? palette.plan : palette.pending));
      arcs.forEach((a) => globe.add(a));
      focusLng = meanLng(sel.length ? sel : pend.length ? pend : []);
      if (reduceMotion) draw(0);
    };

    function layout() {
      const w = host!.clientWidth || 1;
      const h = host!.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const wide = w / h > 1.25;
      camera.fov = wide ? 30 : 38;
      camera.updateProjectionMatrix();
      globe.position.set(wide ? 1.05 : 0, wide ? 0 : -0.35, 0);
      globe.scale.setScalar(wide ? 1 : 0.85);
    }

    function draw(t: number) {
      const target = focusLng !== null ? MathUtils.degToRad(-focusLng) : MathUtils.degToRad(-DEFAULT_LNG) + (reduceMotion ? 0 : t * 0.045);
      yaw += (target - yaw) * (reduceMotion ? 1 : 0.035);
      pointer.sx += (pointer.x - pointer.sx) * 0.05;
      pointer.sy += (pointer.y - pointer.sy) * 0.05;
      globe.rotation.set(0.42 + pointer.sy * 0.1, yaw + pointer.sx * 0.12, 0);
      for (const m of markers) {
        if (m.state === "off") continue;
        const p = (t * 0.7 + m.phase) % 1;
        const speed = m.state === "pending" ? 1 : 0;
        m.ring.scale.setScalar(m.state === "pending" ? 0.6 + p * 2.6 : m.state === "plan" ? 1 + p * 1.6 : 1);
        (m.ring.material as MeshBasicMaterial).opacity = m.state === "candidate" ? 0.25 : (1 - p) * (0.4 + speed * 0.25);
      }
      arcs.forEach((a, i) => {
        const p = (t * 0.32 + i * 0.17) % 1.5;
        a.geometry.setDrawRange(0, Math.max(2, Math.floor(ARC_POINTS * Math.min(1, p))));
        (a.material as LineBasicMaterial).opacity = p > 1 ? 0.45 * (1 - (p - 1) / 0.5) : 0.45;
      });
      renderer.render(scene, camera);
    }

    const start = performance.now();
    let raf = 0;
    let visible = true;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      draw((performance.now() - start) / 1000);
    };
    const play = () => { if (!reduceMotion && visible && !document.hidden && !raf) raf = requestAnimationFrame(tick); };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };

    layout();
    apply.current();
    draw(0);
    play();
    callbacks.current.onReady();

    const resize = new ResizeObserver(() => { layout(); draw((performance.now() - start) / 1000); });
    resize.observe(host);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) play(); else stop(); });
    io.observe(host);
    const onVisibility = () => (document.hidden ? stop() : play());
    const onPointer = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      pointer.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      stop();
      apply.current = null;
      resize.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointer);
      disposeTree(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={mount} className="absolute inset-0" aria-hidden />;
}
