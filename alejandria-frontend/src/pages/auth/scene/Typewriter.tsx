import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

export function Typewriter({ phrases }: { phrases: readonly string[] }) {
  const reduced = useReducedMotion() ?? false;
  const [text, setText] = useState(() => (reduced ? (phrases[0] ?? "") : ""));

  useEffect(() => {
    if (reduced || phrases.length === 0) return;
    let phrase = 0;
    let count = 0;
    let direction: 1 | -1 = 1;
    let timer = 0;

    const tick = () => {
      const full = phrases[phrase] ?? "";
      count += direction;
      setText(full.slice(0, count));
      let delay = direction === 1 ? 55 : 22;
      if (direction === 1 && count >= full.length) {
        direction = -1;
        delay = 2600;
      } else if (direction === -1 && count <= 0) {
        direction = 1;
        phrase = (phrase + 1) % phrases.length;
        delay = 450;
      }
      timer = window.setTimeout(tick, delay);
    };

    timer = window.setTimeout(tick, 700);
    return () => window.clearTimeout(timer);
  }, [phrases, reduced]);

  return (
    <p aria-hidden="true" className="auth-typewriter m-0">
      {text}
      <span className="auth-caret" />
    </p>
  );
}
