import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { es } from "@/i18n/es";
import { CLOTH, EASE, readableOn, type SceneMode } from "./tokens";

/* ------------------------------------------------------------------ */
/* Geometry (SVG user units, viewBox 640 x 600)                        */
/* ------------------------------------------------------------------ */

const LAMP = 560;
const SHELF_TOP = 412;
const SHELF_BASE = 540;
const BRASS = "#D9B866";
const MIRROR = "matrix(-1 0 0 1 640 0)";
const PAGE_D =
  "M320 396 C 290 380, 232 376, 184 388 L 184 316 C 232 304, 290 308, 320 324 Z";
const COVER_D =
  "M320 406 C 288 390, 226 386, 174 399 L 174 308 C 226 295, 290 299, 320 318 Z";

const vars = (v: Record<string, string | number>) => v as CSSProperties;
const reach = (px: number, center: number, radius: number) =>
  Math.max(0, 1 - Math.abs(px - center) / radius);

/* ------------------------------------------------------------------ */
/* Shelf data: deterministic, decorative, no catalog data              */
/* ------------------------------------------------------------------ */

type SpineSpec = {
  w: number;
  h: number;
  color: string;
  face: 0 | 1 | 2 | 3;
  gap?: boolean;
};

const SPINES: readonly SpineSpec[] = [
  { w: 30, h: 104, color: CLOTH.oxblood, face: 0 },
  { w: 24, h: 88, color: CLOTH.slate, face: 3 },
  { w: 32, h: 112, color: CLOTH.ochre, face: 1 },
  { w: 34, h: 96, color: CLOTH.pine, face: 2 },
  { w: 28, h: 116, color: CLOTH.bone, face: 1 },
  { w: 26, h: 84, color: CLOTH.plum, face: 3 },
  { w: 24, h: 100, color: CLOTH.rust, face: 0 },
  { w: 36, h: 110, color: CLOTH.navy, face: 2 },
  { w: 26, h: 100, color: CLOTH.charcoal, face: 0, gap: true }, // the one you will borrow
  { w: 22, h: 92, color: CLOTH.sand, face: 3 },
  { w: 28, h: 106, color: CLOTH.moss, face: 1 },
  { w: 32, h: 114, color: CLOTH.charcoal, face: 0 },
  { w: 26, h: 90, color: CLOTH.russet, face: 2 },
  { w: 30, h: 108, color: CLOTH.oxblood, face: 3 },
  { w: 34, h: 118, color: CLOTH.pine, face: 0 },
  { w: 22, h: 86, color: CLOTH.ochre, face: 1 },
];

const SPINE_GAP = 2;
const ROW_WIDTH = SPINES.reduce((sum, s) => sum + s.w + SPINE_GAP, -SPINE_GAP);

type Laid = SpineSpec & { x: number; i: number; labelIndex: number };

const LAID_OUT: readonly Laid[] = (() => {
  let cursor = 320 - ROW_WIDTH / 2;
  let label = 0;
  return SPINES.map((s, i) => {
    const laid = { ...s, x: cursor, i, labelIndex: s.gap ? -1 : label };
    if (!s.gap) label += 1;
    cursor += s.w + SPINE_GAP;
    return laid;
  });
})();

/* Constellation: little closed books linked like an embedding map */
const NODES = [
  { x: 96, y: 190, c: CLOTH.ochre, r: -8 },
  { x: 176, y: 128, c: CLOTH.slate, r: 6 },
  { x: 262, y: 214, c: CLOTH.oxblood, r: -4 },
  { x: 344, y: 138, c: CLOTH.pine, r: 9 },
  { x: 428, y: 222, c: CLOTH.plum, r: -10 },
  { x: 508, y: 156, c: CLOTH.sand, r: 5 },
  { x: 566, y: 246, c: CLOTH.navy, r: -6 },
  { x: 70, y: 272, c: CLOTH.rust, r: 8 },
  { x: 200, y: 268, c: CLOTH.moss, r: -7 },
] as const;
const HEART = { x: 320, y: 300 };
const POINTS = [...NODES.map((n) => ({ x: n.x, y: n.y })), HEART];
const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6],
  [0, 7], [7, 8], [8, 2], [3, 5], [1, 3], [4, 6],
  [9, 2], [9, 3], [9, 4], [9, 8],
];

/* Page-lines that lift off the book and become nodes */
const TOKENS = Array.from({ length: 12 }, (_, i) => ({
  x: 320 + (i % 2 === 0 ? -1 : 1) * (18 + ((i * 37) % 70)),
  w: 10 + ((i * 7) % 14),
  dx: ((i * 53) % 120) - 60,
  dy: -(120 + ((i * 29) % 70)),
  d: -(i * 0.45),
}));

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Spine({
  s,
  label,
  shelfX,
  animated,
}: {
  s: Laid;
  label: string;
  shelfX: MotionValue<number>;
  animated: boolean;
}) {
  const cx = s.x + s.w / 2;
  const y = useTransform(shelfX, (px) => -22 * reach(px, cx, 64));
  const rotate = useTransform(
    shelfX,
    (px) => (px < cx ? 1 : -1) * 4 * reach(px, cx, 40),
  );
  const x = useTransform(
    shelfX,
    (px) => Math.sign(cx - px) * 6 * reach(px, cx, 100),
  );

  return (
    <motion.g
      initial={animated ? { opacity: 0, y: 24 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: EASE, delay: 0.12 + s.i * 0.018 }}
    >
      <motion.g
        style={animated ? { x, y, rotate, originX: 0.5, originY: 1 } : undefined}
      >
        <g transform={`translate(${s.x} ${SHELF_BASE - s.h})`}>
          <rect width={s.w} height={s.h} rx={1.5} fill={s.color} />
          <rect width={2.2} height={s.h} fill="#fff" opacity={0.14} />
          <rect x={s.w - 3} width={3} height={s.h} fill="#000" opacity={0.2} />
          <rect y={9} width={s.w} height={2} fill={BRASS} opacity={0.9} />
          <rect y={s.h - 13} width={s.w} height={2} fill={BRASS} opacity={0.9} />
          <text
            className={`scene-spine face-${s.face}`}
            fill={readableOn(s.color)}
            transform={`translate(${s.w / 2} 19) rotate(90)`}
            dominantBaseline="central"
          >
            {label}
          </text>
        </g>
      </motion.g>
    </motion.g>
  );
}

function Node({ n, i }: { n: (typeof NODES)[number]; i: number }) {
  return (
    <g transform={`translate(${n.x} ${n.y})`}>
      <g className="scene-node" style={vars({ "--i": i, "--d": `${-i * 0.9}s` })}>
        <circle className="scene-halo" r={15} fill="none" stroke="#F6D77A" strokeWidth={1} />
        <g transform={`rotate(${n.r})`}>
          <rect x={-5} y={-9} width={10} height={18} rx={1.5} fill={n.c} />
          <rect x={-5} y={-4} width={10} height={1.6} fill={BRASS} />
          <rect x={-5} y={3} width={10} height={1.6} fill={BRASS} opacity={0.7} />
        </g>
      </g>
    </g>
  );
}

function PageLines() {
  return (
    <g fill="none" stroke="#1B1A17" strokeWidth={1.1} strokeLinecap="round" opacity={0.3}>
      {Array.from({ length: 5 }, (_, k) => (
        <path
          key={k}
          pathLength={1}
          strokeDasharray={k === 2 || k === 4 ? "0.8 1" : undefined}
          d={`M198 ${332 + k * 11.5} C 236 ${322 + k * 11.5}, 284 ${325 + k * 11.5}, 308 ${339 + k * 11.5}`}
        />
      ))}
    </g>
  );
}

function BookHalf() {
  return (
    <>
      <path d={COVER_D} fill={CLOTH.oxblood} />
      <path d={PAGE_D} transform="translate(0 6)" fill="#BDB7A5" />
      <path d={PAGE_D} transform="translate(0 3)" fill="#CFC9B8" />
      <path d={PAGE_D} fill="url(#auth-pg)" />
      <PageLines />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

export function AlejandriaScene({ mode }: { mode: SceneMode }) {
  const reduced = useReducedMotion() ?? false;
  const animated = !reduced;
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const shelfX = useMotionValue(-999);
  const parallax = useMotionValue(0);
  const lampRawX = useMotionValue(0);
  const lampRawY = useMotionValue(0);
  const lampX = useSpring(lampRawX, { stiffness: 60, damping: 18, mass: 0.9 });
  const lampY = useSpring(lampRawY, { stiffness: 60, damping: 18, mass: 0.9 });
  const nodesX = useTransform(parallax, [-1, 1], [10, -10]);
  const nodesY = useTransform(parallax, [-1, 1], [3, -3]);

  const restLamp = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    lampRawX.set(width * 0.78 - LAMP / 2);
    lampRawY.set(height * 0.1 - LAMP / 2);
  }, [lampRawX, lampRawY]);

  useEffect(() => {
    restLamp();
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(restLamp);
    observer.observe(el);
    return () => observer.disconnect();
  }, [restLamp]);

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!animated || e.pointerType !== "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    lampRawX.set(e.clientX - rect.left - LAMP / 2);
    lampRawY.set(e.clientY - rect.top - LAMP / 2);
    parallax.set(((e.clientX - rect.left) / rect.width - 0.5) * 2);

    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    shelfX.set(p.y > SHELF_TOP ? p.x : -999);
  };

  const onPointerLeave = () => {
    shelfX.set(-999);
    parallax.set(0);
    restLamp();
  };

  return (
    <div
      ref={rootRef}
      className="auth-scene"
      data-mode={mode}
      aria-hidden="true"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 640 600"
        preserveAspectRatio="xMidYMax slice"
        focusable="false"
      >
        <defs>
          <filter id="auth-felt" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" />
            <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.2 0 0 0 -0.45" />
          </filter>
          <linearGradient id="auth-pg" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#EDE9DC" />
            <stop offset="0.7" stopColor="#E8E4D8" />
            <stop offset="1" stopColor="#BFB79F" />
          </linearGradient>
          <radialGradient id="auth-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#F6D77A" stopOpacity="0.42" />
            <stop offset="1" stopColor="#F6D77A" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="auth-beam" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#F6D77A" stopOpacity="0" />
            <stop offset="0.5" stopColor="#F6D77A" stopOpacity="0.3" />
            <stop offset="1" stopColor="#F6D77A" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="auth-niche" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0.4" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="auth-under" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0.5" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* baize cloth grain */}
        <rect width="640" height="600" filter="url(#auth-felt)" opacity="0.35" />

        {/* constellation */}
        <motion.g style={animated ? { x: nodesX, y: nodesY } : undefined}>
          {EDGES.map(([a, b], k) => {
            const p = POINTS[a];
            const q = POINTS[b];
            if (!p || !q) return null;
            return <line key={k} className="scene-edge" x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
          })}
          {NODES.map((n, i) => (
            <Node key={i} n={n} i={i} />
          ))}
        </motion.g>

        {/* page-lines lifting off the book */}
        {TOKENS.map((t, i) => (
          <g key={i} transform={`translate(${t.x} 346)`}>
            <rect
              className="scene-token"
              x={-t.w / 2}
              width={t.w}
              height={2.6}
              rx={1.3}
              fill="#E8E4D8"
              style={vars({ "--dx": `${t.dx}px`, "--dy": `${t.dy}px`, "--d": `${t.d}s` })}
            />
          </g>
        ))}

        {/* the open book */}
        <ellipse className="scene-book-shadow" cx="320" cy="408" rx="120" ry="4.5" fill="#000" />
        <g className="scene-book">
          <ellipse className="scene-book-glow" cx="320" cy="340" rx="210" ry="70" fill="url(#auth-glow)" />
          <BookHalf />
          <g transform={MIRROR}>
            <BookHalf />
          </g>
          <path d="M320 324 L320 398" stroke="#000" strokeOpacity="0.3" strokeWidth="2" />
          <g className="scene-flip">
            <g transform={MIRROR}>
              <path d={PAGE_D} fill="url(#auth-pg)" stroke="#BFB79F" strokeWidth="0.6" />
              <PageLines />
            </g>
          </g>
        </g>

        {/* the bookcase */}
        <rect x="36" y={SHELF_TOP} width="568" height={SHELF_BASE - SHELF_TOP} fill="#2E1C13" />
        <rect x="36" y={SHELF_TOP} width="568" height="44" fill="url(#auth-niche)" />
        <g className="scene-shelf">
          {LAID_OUT.map((s) =>
            s.gap ? (
              <rect
                key={s.i}
                className="scene-gap"
                x={s.x + 1}
                y={SHELF_BASE - s.h}
                width={s.w - 2}
                height={s.h}
                rx={2}
                fill="none"
                stroke="#E8E4D8"
                strokeWidth="1"
                strokeDasharray="3 4"
              />
            ) : (
              <Spine
                key={s.i}
                s={s}
                label={es.auth.sceneGenres[s.labelIndex] ?? ""}
                shelfX={shelfX}
                animated={animated}
              />
            ),
          )}
        </g>
        <rect x="30" y="402" width="580" height="10" fill="#4A2F20" />
        <rect x="30" y="402" width="580" height="1.5" fill="#7A5436" />
        <rect x="30" y="402" width="6" height="154" fill="#4A2F20" />
        <rect x="604" y="402" width="6" height="154" fill="#4A2F20" />
        <rect x="24" y={SHELF_BASE} width="592" height="16" fill="#4A2F20" />
        <rect x="24" y={SHELF_BASE} width="592" height="1.5" fill="#7A5436" />
        <rect x="24" y="556" width="592" height="30" fill="url(#auth-under)" />

        {/* reading light that sweeps the shelf while signing in */}
        <g className="scene-beam">
          <rect x="-80" y="0" width="160" height="600" fill="url(#auth-beam)" />
        </g>
      </svg>

      {animated ? (
        <motion.div
          className="auth-lamp"
          style={{ x: lampX, y: lampY, width: LAMP, height: LAMP }}
        />
      ) : null}
    </div>
  );
}
