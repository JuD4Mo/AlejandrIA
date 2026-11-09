import { cn } from "@/lib/cn";

const positions = [
  { x: 260, y: 210 },
  { x: 116, y: 112 },
  { x: 406, y: 96 },
  { x: 104, y: 318 },
  { x: 416, y: 322 },
];

const nodeColors = ["#6b2024", "#33453b", "#3e4657", "#6c4a2e"];

const specks = [
  [54, 74],
  [448, 46],
  [198, 38],
  [340, 62],
  [72, 226],
  [470, 212],
  [184, 382],
  [318, 388],
  [38, 160],
  [486, 130],
];

export function Constellation({
  connected,
  labels,
  phase = "asking",
  className,
}: {
  connected: number;
  labels: readonly string[];
  phase?: "idle" | "asking" | "complete";
  className?: string;
}) {
  const center = positions[0];
  const shown = Math.min(connected, labels.length);

  return (
    <svg
      viewBox="0 0 520 420"
      role="img"
      aria-label={`${shown} de ${labels.length} nodos conectados`}
      className={cn(
        "h-full w-full overflow-visible",
        phase === "complete" && "constellation-complete",
        className,
      )}
    >
      <defs>
        <radialGradient id="onboarding-node-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a8863b" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#a8863b" stopOpacity="0" />
        </radialGradient>
        <filter id="onboarding-soft-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle
        cx={center.x}
        cy={center.y}
        r="150"
        fill="none"
        stroke="rgba(243,240,250,0.16)"
        strokeWidth="1"
        strokeDasharray="2 11"
        className={phase === "complete" ? "constellation-orbit" : undefined}
        style={{ transformOrigin: `${center.x}px ${center.y}px` }}
      />

      {specks.map(([x, y], index) => (
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          r={index % 3 === 0 ? 1.7 : 1}
          fill="rgba(168,134,59,0.46)"
        />
      ))}

      {positions.slice(1).map((node, index) => {
        if (index >= shown) return null;
        const previous = index === 0 ? center : positions[index];
        const delay = `${index * 90}ms`;
        const color = nodeColors[index % nodeColors.length];
        return (
          <g
            key={labels[index]}
            className="constellation-node"
            style={{
              transformOrigin: `${node.x}px ${node.y}px`,
              animationDelay: delay,
            }}
          >
            <circle
              cx={node.x}
              cy={node.y}
              r="34"
              fill="url(#onboarding-node-glow)"
              className="constellation-node-halo"
            />
            <line
              x1={center.x}
              y1={center.y}
              x2={node.x}
              y2={node.y}
              pathLength={1}
              stroke="rgba(107,32,36,0.42)"
              strokeWidth="1.2"
              className="constellation-link"
              style={{ animationDelay: delay }}
            />
            {index > 0 ? (
              <line
                x1={previous.x}
                y1={previous.y}
                x2={node.x}
                y2={node.y}
                pathLength={1}
                stroke="rgba(168,134,59,0.4)"
                strokeWidth="1"
                strokeDasharray="3 7"
                className="constellation-link"
                style={{ animationDelay: delay }}
              />
            ) : null}
            <circle cx={node.x} cy={node.y} r="10" fill={color} stroke="#f3f0fa" strokeWidth="2" />
            <circle
              cx={node.x}
              cy={node.y}
              r="19"
              fill="none"
              stroke={color}
              strokeOpacity="0.38"
              strokeWidth="1"
            />
            <text
              x={node.x}
              y={node.y + 34}
              textAnchor="middle"
              fill="rgba(243,240,250,0.72)"
              fontFamily="var(--font-body)"
              fontSize="11"
              fontWeight="600"
              letterSpacing="0.08em"
            >
              {labels[index].toLocaleUpperCase("es")}
            </text>
          </g>
        );
      })}

      <circle
        cx={center.x}
        cy={center.y}
        r="44"
        fill="none"
        stroke="rgba(168,134,59,0.4)"
        strokeWidth="1"
        className="constellation-halo"
        style={{ transformOrigin: `${center.x}px ${center.y}px` }}
      />
      <circle
        cx={center.x}
        cy={center.y}
        r="29"
        fill="#6b2024"
        stroke="#f3f0fa"
        strokeWidth="2"
        filter={phase === "complete" ? "url(#onboarding-soft-glow)" : undefined}
      />
      <text
        x={center.x}
        y={center.y + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#f3f0fa"
        fontFamily="var(--font-display)"
        fontSize="25"
        fontWeight="600"
      >
        A
      </text>
    </svg>
  );
}
