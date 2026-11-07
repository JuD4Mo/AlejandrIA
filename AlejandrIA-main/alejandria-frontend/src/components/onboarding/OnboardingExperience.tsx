import { useState } from "react";
import type { NamedEntity } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es, interpolate } from "@/i18n/es";
import { cn } from "@/lib/cn";
import {
  resolveGenreIds,
  selectedOptionLabels,
  type OnboardingAnswers,
} from "@/lib/onboarding";
import { Constellation } from "./Constellation";

const questions = es.onboarding.questions;
const nodeLabels = questions.map((question) => question.nodeLabel);

type Stage = "intro" | "questions" | "saving" | "complete";

export function OnboardingExperience({
  genres,
  onSave,
  onDone,
  onSkip,
}: {
  genres: NamedEntity[];
  onSave: (genreIds: number[]) => Promise<void>;
  onDone: () => void;
  onSkip: () => void;
}) {
  useDocumentTitle(es.onboarding.documentTitle);
  const [stage, setStage] = useState<Stage>("intro");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>({});
  const [matchedGenres, setMatchedGenres] = useState(0);
  const [error, setError] = useState<unknown>(null);

  const connected = stage === "intro" ? 0 : Object.keys(answers).length;
  const question = questions[step];
  const answer = answers[question.id];
  const isLast = step === questions.length - 1;
  const noGenres = genres.length === 0;

  const choose = (optionId: string) => {
    setAnswers((current) => ({ ...current, [question.id]: optionId }));
    setError(null);
  };

  const save = async () => {
    setStage("saving");
    setError(null);
    const ids = resolveGenreIds(answers, genres);
    try {
      await onSave(ids);
      setMatchedGenres(ids.length);
      setStage("complete");
    } catch (caught) {
      setError(caught);
      setStage("questions");
    }
  };

  const advance = () => {
    if (!answer) return;
    if (isLast) {
      void save();
      return;
    }
    setStep((current) => Math.min(current + 1, questions.length - 1));
    setError(null);
  };

  const goBack = () => {
    setStep((current) => Math.max(current - 1, 0));
    setError(null);
  };

  if (noGenres) {
    return (
      <Shell onSkip={onSkip} showSkip={false}>
        <div className="paper-panel mx-auto max-w-xl px-6 py-8 text-center sm:px-10">
          <p className="text-[0.74rem] font-semibold text-brass-text">
            {es.onboarding.eyebrow}
          </p>
          <h1 className="display-title mt-2 text-4xl text-ink">
            {es.onboarding.noGenresTitle}
          </h1>
          <p className="mt-3 text-[0.94rem] leading-relaxed text-[rgba(243,240,250,0.7)]">
            {es.onboarding.noGenresBody}
          </p>
          <Button className="mt-6" onClick={onSkip}>
            {es.onboarding.continueAnyway}
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      onSkip={onSkip}
      showSkip={stage !== "complete" && stage !== "saving"}
    >
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-6 sm:px-6 lg:min-h-[calc(100vh-9rem)] lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:gap-12 lg:py-10">
        <section className="relative order-1 min-h-[270px] sm:min-h-[340px] lg:order-none lg:min-h-[460px]">
          <Constellation
            connected={connected}
            labels={nodeLabels}
            phase={
              stage === "complete"
                ? "complete"
                : stage === "intro"
                  ? "idle"
                  : "asking"
            }
            className="absolute inset-0"
          />
          <p className="absolute inset-x-0 bottom-0 text-center text-[0.78rem] font-semibold tracking-[0.08em] text-[rgba(243,240,250,0.52)]">
            {interpolate(es.onboarding.connected, {
              count: connected,
              total: questions.length,
            })}
          </p>
        </section>

        <section className="order-2 min-w-0">
          {stage === "intro" ? (
            <Intro onStart={() => setStage("questions")} />
          ) : stage === "complete" ? (
            <Complete
              answers={answers}
              matchedGenres={matchedGenres}
              onEnter={onDone}
            />
          ) : (
            <div className="paper-panel px-5 py-6 sm:px-8 sm:py-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 text-[0.74rem] font-semibold text-brass-text">
                  {interpolate(es.onboarding.progress, {
                    current: step + 1,
                    total: questions.length,
                  })}
                </p>
                <div className="flex gap-1.5" aria-hidden="true">
                  {questions.map((item, index) => (
                    <span
                      key={item.id}
                      className={cn(
                        "h-1.5 w-7 transition-colors",
                        answers[item.id]
                          ? "bg-oxblood"
                          : index === step
                            ? "bg-brass"
                            : "bg-[rgba(243,240,250,0.16)]",
                      )}
                    />
                  ))}
                </div>
              </div>

              <h1 className="display-title mt-4 text-4xl text-ink sm:text-5xl">
                {question.prompt}
              </h1>
              <p className="mt-2 text-[0.92rem] leading-relaxed text-[rgba(243,240,250,0.68)]">
                {question.hint}
              </p>

              <div
                role="group"
                aria-label={question.prompt}
                className="mt-5 grid gap-2 sm:grid-cols-2"
              >
                {question.options.map((option) => {
                  const checked = answer === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => choose(option.id)}
                      className={cn(
                        "group flex h-full flex-col items-start border px-3.5 py-3 text-left transition-colors",
                        checked
                          ? "border-[rgba(107,32,36,0.42)] bg-[rgba(107,32,36,0.07)]"
                          : "border-[rgba(243,240,250,0.16)] bg-[rgba(21,21,30,0.6)] hover:border-[rgba(243,240,250,0.32)] hover:bg-surface",
                      )}
                    >
                      <span className="flex w-full items-start gap-2">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                            checked
                              ? "border-oxblood bg-oxblood"
                              : "border-[rgba(243,240,250,0.34)]",
                          )}
                        >
                          {checked ? (
                            <span className="size-1.5 rounded-full bg-[#f3f0fa]" />
                          ) : null}
                        </span>
                        <span className="text-[0.9rem] font-semibold leading-snug text-ink">
                          {option.label}
                        </span>
                      </span>
                      <span className="mt-1 pl-6 text-[0.78rem] leading-snug text-[rgba(243,240,250,0.6)]">
                        {option.note}
                      </span>
                    </button>
                  );
                })}
              </div>

              {error ? (
                <div className="mt-4">
                  <ErrorState error={error} compact />
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(243,240,250,0.14)] pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={step === 0 ? undefined : goBack}
                  disabled={step === 0 || stage === "saving"}
                  className={step === 0 ? "invisible" : undefined}
                >
                  {es.onboarding.back}
                </Button>
                <div className="flex items-center gap-2">
                  {error ? (
                    <Button variant="secondary" onClick={() => void save()}>
                      {es.onboarding.retry}
                    </Button>
                  ) : null}
                  <Button
                    onClick={advance}
                    disabled={!answer || stage === "saving"}
                    loading={stage === "saving"}
                  >
                    {stage === "saving"
                      ? es.onboarding.saving
                      : isLast
                        ? es.onboarding.finish
                        : es.onboarding.next}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}

function Shell({
  children,
  onSkip,
  showSkip,
}: {
  children: React.ReactNode;
  onSkip: () => void;
  showSkip: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[rgba(243,240,250,0.14)] px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <p className="m-0 flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="relative flex size-8 items-center justify-center border border-[rgba(243,240,250,0.3)] font-display text-lg font-semibold text-oxblood"
            >
              A
              <span className="absolute inset-x-1.5 bottom-1 h-px bg-brass" />
            </span>
            <span className="font-display text-xl font-semibold">{es.app.name}</span>
          </p>
          {showSkip ? (
            <Button variant="ghost" size="sm" onClick={onSkip}>
              {es.onboarding.skip}
            </Button>
          ) : null}
        </div>
      </header>
      <main className="flex flex-1 flex-col justify-center">{children}</main>
      <footer className="px-4 pb-5 text-center text-[0.72rem] text-[rgba(243,240,250,0.5)]">
        {es.onboarding.skipHint}
      </footer>
    </div>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="paper-panel px-6 py-8 sm:px-10 sm:py-10">
      <p className="m-0 text-[0.74rem] font-semibold text-brass-text">
        {es.onboarding.eyebrow}
      </p>
      <h1 className="display-title mt-3 text-5xl text-ink sm:text-6xl">
        {es.onboarding.introTitle}
      </h1>
      <p className="mt-4 max-w-xl text-[0.98rem] leading-relaxed text-[rgba(243,240,250,0.72)]">
        {es.onboarding.introBody}
      </p>
      <p className="mt-3 max-w-xl text-[0.82rem] leading-relaxed text-[rgba(243,240,250,0.56)]">
        {es.onboarding.introNote}
      </p>
      <Button size="lg" className="mt-6" onClick={onStart}>
        {es.onboarding.start}
      </Button>
    </div>
  );
}

function Complete({
  answers,
  matchedGenres,
  onEnter,
}: {
  answers: OnboardingAnswers;
  matchedGenres: number;
  onEnter: () => void;
}) {
  const labels = selectedOptionLabels(answers);
  return (
    <div className="paper-panel slow-fade px-6 py-8 sm:px-10 sm:py-10">
      <p className="m-0 text-[0.74rem] font-semibold text-brass-text">
        {es.onboarding.eyebrow}
      </p>
      <h1 className="display-title mt-3 text-5xl text-ink sm:text-6xl">
        {es.onboarding.completeTitle}
      </h1>
      <p className="mt-4 text-[0.96rem] leading-relaxed text-[rgba(243,240,250,0.72)]">
        {matchedGenres > 0
          ? es.onboarding.completeBody
          : es.onboarding.completeNoMatches}
      </p>
      <div className="mt-5 border-t border-[rgba(243,240,250,0.14)] pt-4">
        <p className="m-0 text-[0.72rem] font-semibold text-[rgba(243,240,250,0.52)]">
          {es.onboarding.selectedLabel}
        </p>
        <ul className="mt-2 flex flex-wrap gap-2 p-0">
          {labels.map((label) => (
            <li
              key={label}
              className="list-none border border-[rgba(168,134,59,0.34)] bg-[rgba(168,134,59,0.1)] px-2.5 py-1 text-[0.78rem] text-[#5c4818]"
            >
              {label}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-4 text-[0.8rem] text-[rgba(243,240,250,0.56)]">
        {es.onboarding.preferencesNote}
      </p>
      <Button size="lg" className="mt-6" onClick={onEnter}>
        {es.onboarding.enter}
      </Button>
    </div>
  );
}
