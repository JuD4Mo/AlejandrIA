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

let introPlayed = false;

export type FlipBookLabels = {
  group: string;
  ribbons: string;
  prev: string;
  next: string;
  position: (current: number, total: number) => string;
};

type FlipBookProps = {
  pages: readonly ReactNode[];
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
    const mediaQuery = window.matchMedia(query);
    const onChange = () => setMatches(mediaQuery.matches);
    onChange();
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

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
  const mounted = useRef(false);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

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
    <motion.div className="book-leaf" style={{ rotateY: rotate, zIndex: moving ? 60 : z }}>
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
  const [fast, setFast] = useState(
    () => !reduced && isSpread && !introPlayed && total >= 6,
  );
  const timers = useRef<number[]>([]);

  const step = isSpread ? 2 : 1;
  const normalizedPage = isSpread && page % 2 === 1 ? page - 1 : page;
  const spread = Math.floor(normalizedPage / 2);
  const canPrev = normalizedPage > 0;
  const canNext = normalizedPage < total - step;

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

  useEffect(() => {
    if (reduced || !isSpread || introPlayed || total < 6) return;
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

  const visible = (index: number) => (isSpread ? Math.floor(index / 2) === spread : index === page);
  const side = (index: number) => (isSpread && index % 2 === 0 ? "l" : "r");
  const wrap = (index: number) => <div className={`book-page book-page--${side(index)}`}>{pages[index]}</div>;
  const mode = isSpread ? "spread" : "single";
  const duration = fast ? RIFFLE : TURN;
  const position = isSpread ? labels.position(spread + 1, spreads) : labels.position(page + 1, total);

  const stage = reduced ? (
    <motion.div key={isSpread ? spread : page} className="book-stage" data-mode={mode} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12 }}>
      {isSpread ? <><div className="book-half book-half--left">{wrap(spread * 2)}</div><div className="book-half book-half--right">{wrap(spread * 2 + 1)}</div></> : <div className="book-half book-half--single">{wrap(page)}</div>}
    </motion.div>
  ) : isSpread ? (
    <div className="book-stage" data-mode="spread">
      <div className="book-half book-half--left" {...hiddenProps(!visible(0))}>{wrap(0)}</div>
      <div className="book-half book-half--right" {...hiddenProps(!visible(total - 1))}>{wrap(total - 1)}</div>
      {Array.from({ length: spreads - 1 }, (_, index) => <Leaf key={index} flipped={index < spread} z={(index < spread ? index : spreads - 2 - index) + 1} duration={duration} front={wrap(2 * index + 1)} back={wrap(2 * index + 2)} frontHidden={!visible(2 * index + 1)} backHidden={!visible(2 * index + 2)} />)}
      {canPrev ? <button type="button" tabIndex={-1} aria-hidden="true" className="book-corner book-corner--l" onClick={() => goTo(page - 2)} /> : null}
      {canNext ? <button type="button" tabIndex={-1} aria-hidden="true" className="book-corner book-corner--r" onClick={() => goTo(page + 2)} /> : null}
    </div>
  ) : (
    <div className="book-stage" data-mode="single">
      {pages.map((_, index) => <Leaf key={index} flipped={index < page} z={(index < page ? index : total - index) + 1} duration={duration} front={wrap(index)} frontHidden={!visible(index)} backHidden />)}
      {canNext ? <button type="button" tabIndex={-1} aria-hidden="true" className="book-corner book-corner--r" onClick={() => goTo(page + 1)} /> : null}
    </div>
  );

  return (
    <div role="group" aria-label={labels.group}>
      <div className="book-ribbons" role="group" aria-label={labels.ribbons}>
        {ribbons.map((label, index) => <button key={label} type="button" data-i={index} className="book-ribbon" aria-current={spread === index ? "true" : undefined} onClick={() => goTo(index * 2)}>{label}</button>)}
      </div>
      <div className="book-shell" data-mode={mode}>{stage}</div>
      <div className="book-controls">
        <button type="button" className="book-turn" disabled={!canPrev} onClick={() => goTo(page - step)}>{labels.prev}</button>
        <p className="book-position" aria-live="polite">{position}</p>
        <button type="button" className="book-turn" disabled={!canNext} onClick={() => goTo(page + step)}>{labels.next}</button>
      </div>
    </div>
  );
}
