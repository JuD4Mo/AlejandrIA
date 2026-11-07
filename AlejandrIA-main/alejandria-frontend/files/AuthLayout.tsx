import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { es } from "@/i18n/es";
import { AlejandriaScene } from "./scene/AlejandriaScene";
import { Typewriter } from "./scene/Typewriter";
import { EASE, type SceneMode } from "./scene/tokens";
import "./auth.css";

type AuthLayoutProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  sceneMode?: SceneMode;
  children: ReactNode;
};

function Sparkle() {
  return (
    <svg className="auth-sparkle" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 0C12.8 7.2 16.8 11.2 24 12C16.8 12.8 12.8 16.8 12 24C11.2 16.8 7.2 12.8 0 12C7.2 11.2 11.2 7.2 12 0Z"
      />
    </svg>
  );
}

function Wordmark() {
  // "Alejandría" drops its last two letters; "IA" is the accent.
  const stem = es.auth.brand.slice(0, -2);
  return (
    <p className="m-0 flex items-center gap-3">
      <span className="auth-plate" aria-hidden="true">
        A
      </span>
      <span className="sr-only">{es.auth.brand}</span>
      <span className="auth-wordmark-text" aria-hidden="true">
        {stem}
        <span className="auth-ia">
          IA
          <Sparkle />
        </span>
      </span>
    </p>
  );
}

export function AuthLayout({
  title,
  subtitle,
  footer,
  sceneMode = "idle",
  children,
}: AuthLayoutProps) {
  const reduced = useReducedMotion() ?? false;

  return (
    <div className="auth-root min-h-dvh lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(26rem,0.9fr)]">
      <div className="relative min-h-[18rem] lg:min-h-dvh">
        <AlejandriaScene mode={sceneMode} />
        <div className="pointer-events-none relative z-10 p-5 lg:p-10">
          <Wordmark />
          <div className="mt-3 hidden lg:block">
            <Typewriter phrases={es.auth.sceneCaptions} />
          </div>
        </div>
      </div>

      <main
        id="main"
        className="relative z-10 -mt-8 flex items-start justify-center px-4 pb-10 lg:mt-0 lg:items-center lg:px-12 lg:py-12"
      >
        <motion.section
          className="auth-card w-full max-w-[28rem]"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 28, rotate: -1.2 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{
            duration: reduced ? 0.12 : 0.42,
            ease: EASE,
            delay: reduced ? 0 : 0.25,
          }}
        >
          <header className="auth-card-head">
            <h1 className="auth-title">{title}</h1>
            {subtitle ? <p className="auth-subtitle">{subtitle}</p> : null}
          </header>
          <div className="auth-card-body">{children}</div>
          {footer ? <div className="auth-card-foot">{footer}</div> : null}
          <span className="auth-hole" aria-hidden="true" />
          <span className="auth-rod" aria-hidden="true" />
        </motion.section>
      </main>
    </div>
  );
}
