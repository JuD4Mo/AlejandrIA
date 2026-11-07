import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";

const EASE = [0.2, 0.8, 0.2, 1] as const;
const TURN = 0.56;
const RIFFLE = 0.3;

/** The intro riffle plays once per SPA session, not on every visit to Home. */
let introPlayed = false;

export type FlipBookLabels = {
  group: string;
  ribbons: string;
  prev: string;
  next: string;
  position: (current: number, total: number) => string;
};

type FlipBookProps = {
  /** Even length. pages[0] is the left page of spread 0, pages[1] the right page. */
  pages: readonly ReactNode[];
  /** One ribbon label per spread. */
  ribbons: readonly string[];
  labels: FlipBookLabels;
};

function useMediaQuery(query: string): boolean {
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Pages that are not on screen must not be reachable by keyboard or screen reader. */
function hiddenProps(hidden: boolean): HTMLAttributes<HTMLDivElement> {
  return hidden
    ? ({ inert: "", "aria-hidden": true } as unknown as HTMLAttributes<HTMLDivElement>)
    : {};
}

type LeafProps = {
  flipped: boolean;
  z: number;
  duration: number;
  front: ReactNode;
  back?: ReactNode;
  frontHidden: boolean;
  backHidden: boolean;
};

function Leaf({ flipped, z, duration, front, back, frontHidden, backHidden }: LeafProps) {
  const rotate = useMotionValue(flipped ? -180 : 0);
  const shade = useTransform(rotate, [-180, -90, 0], [0, 0.34, 0]);
  const [moving, setMoving] = useState(false);
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setMoving(true);
    const controls = animate(rotate, flipped ? -180 : 0, {
      duration: durationRef.current,
      ease: EASE,
    });
    controls.then(() => setMoving(false));
    return () => controls.stop();
  }, [flipped, rotate]);

  return (
    <motion.div
      className="book-leaf"
      style={{ rotateY: rotate, zIndex: moving ? 60 : z }}
    >
      <div className="book-face book-front" {...hiddenProps(frontHidden)}>
        {front}
        <motion.span className="book-shade" style={{ opacity: shade }} aria-hidden="true" />
      </div>
      {back !== undefined ? (
        <div className="book-face book-back" {...hiddenProps(backHidden)}>
          {back}
          <motion.span className="book-shade" style={{ opacity: shade }} aria-hidden="true" />
        </div>
      ) : null}
    </motion.div>
  );
}

export function FlipBook({ pages, ribbons, labels }: FlipBookProps) {
  const total = pages.length;
  const spreads = total / 2;
  const reduced = useReducedMotion() ?? false;
  const isSpread = useMediaQuery("(min-width: 48rem)");
  const [page, setPage] = useState(0);
  const [fast, setFast] = useState(false);
  const timers = useRef<number[]>([]);

  const step = isSpread ? 2 : 1;
  const spread = Math.floor(page / 2);
  const canPrev = page > 0;
  const canNext = page < total - step;

  const cancelIntro = useCallback(() => {
    if (timers.current.length > 0) introPlayed = true;
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    setFast(false);
  }, []);

  const goTo = useCallback(
    (target: number) => {
      cancelIntro();
      setPage(Math.max(0, Math.min(total - 1, target)));
    },
    [cancelIntro, total],
  );

  // Spread mode always sits on an even page.
  useEffect(() => {
    if (isSpread && page % 2 === 1) setPage(page - 1);
  }, [isSpread, page]);

  // One-time riffle: the book fans through its pages, then settles on the first spread.
  useEffect(() => {
    if (reduced || !isSpread || introPlayed || total < 6) return;
    setFast(true);
    const sequence: ReadonlyArray<readonly [number, number]> = [
      [450, 2],
      [720, 4],
      [1150, 2],
      [1420, 0],
    ];
    timers.current = sequence.map(([ms, target], index) =>
      window.setTimeout(() => {
        setPage(target);
        if (index === sequence.length - 1) {
          introPlayed = true;
          setFast(false);
          timers.current = [];
        }
      }, ms),
    );
    return () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };
  }, [reduced, isSpread, total]);

  const visible = (k: number) => (isSpread ? Math.floor(k / 2) === spread : k === page);
  const side = (k: number) => (isSpread && k % 2 === 0 ? "l" : "r");
  const wrap = (k: number) => (
    <div className={`book-page book-page--${side(k)}`}>{pages[k]}</div>
  );
  const mode = isSpread ? "spread" : "single";
  const duration = fast ? RIFLE : TURN;

  const position = isSpread
    ? labels.position(spread + 1, spreads)
    : labels.position(page + 1, total);

  const stage = reduced ? (
    <motion.div
      key={isSpread ? spread : page}
      className="book-stage"
      data-mode={mode}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12 }}
    >
      {isSpread ? (
        <>
          <div className="book-half book-half--left">{wrap(spread * 2)}</div>
          <div className="book-half book-half--right">{wrap(spread * 2 + 1)}</div>
        </>
      ) : (
        <div className="book-half book-half--single">{wrap(page)}</div>
      )}
    </motion.div>
  ) : isSpread ? (
    <div className="book-stage" data-mode="spread">
      <div className="book-half book-half--left" {...hiddenProps(!visible(0))}>
        {wrap(0)}
      </div>
      <div className="book-half book-half--right" {...hiddenProps(!visible(total - 1))}>
        {wrap(total - 1)}
      </div>
      {Array.from({ length: spreads - 1 }, (_, i) => {
        const flipped = i < spread;
        return (
          <Leaf
            key={i}
            flipped={flipped}
            z={(flipped ? i : spreads - 2 - i) + 1}
            duration={duration}
            front={wrap(2 * i + 1)}
            back={wrap(2 * i + 2)}
            frontHidden={!visible(2 * i + 1)}
            backHidden={!visible(2 * i + 2)}
          />
        );
      })}
      {canPrev ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="book-corner book-corner--l"
          onClick={() => goTo(page - 2)}
        />
      ) : null}
      {canNext ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="book-corner book-corner--r"
          onClick={() => goTo(page + 2)}
        />
      ) : null}
    </div>
  ) : (
    <div className="book-stage" data-mode="single">
      {pages.map((_, k) => {
        const flipped = k < page;
        return (
          <Leaf
            key={k}
            flipped={flipped}
            z={(flipped ? k : total - k) + 1}
            duration={duration}
            front={wrap(k)}
            frontHidden={!visible(k)}
            backHidden
          />
        );
      })}
      {canNext ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="book-corner book-corner--r"
          onClick={() => goTo(page + 1)}
        />
      ) : null}
    </div>
  );

  return (
    <div role="group" aria-label={labels.group}>
      <div className="book-ribbons" role="group" aria-label={labels.ribbons}>
        {ribbons.map((label, i) => (
          <button
            key={label}
            type="button"
            data-i={i}
            className="book-ribbon"
            aria-current={spread === i ? "true" : undefined}
            onClick={() => goTo(i * 2)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="book-shell" data-mode={mode}>
        {stage}
      </div>
      <div className="book-controls">
        <button
          type="button"
          className="book-turn"
          disabled={!canPrev}
          onClick={() => goTo(page - step)}
        >
          {labels.prev}
        </button>
        <p className="book-position" aria-live="polite">
          {position}
        </p>
        <button
          type="button"
          className="book-turn"
          disabled={!canNext}
          onClick={() => goTo(page + step)}
        >
          {labels.next}
        </button>
      </div>
    </div>
  );
}
