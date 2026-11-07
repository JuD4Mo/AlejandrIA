import type { NamedEntity } from "@/api/types";
import { es } from "@/i18n/es";

export type OnboardingQuestion = (typeof es.onboarding.questions)[number];
export type OnboardingOption = OnboardingQuestion["options"][number];
export type OnboardingAnswers = Record<string, string>;

const STORAGE_PREFIX = "alejandria.onboarding.";

function normalize(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function optionFor(
  questionId: string,
  optionId: string | undefined,
): OnboardingOption | undefined {
  if (!optionId) return undefined;
  const question = es.onboarding.questions.find(
    (candidate) => candidate.id === questionId,
  );
  return question?.options.find((option) => option.id === optionId);
}

export function selectedOptionLabels(answers: OnboardingAnswers): string[] {
  return es.onboarding.questions.flatMap((question) => {
    const option = optionFor(question.id, answers[question.id]);
    return option ? [option.label] : [];
  });
}

export function resolveGenreIds(
  answers: OnboardingAnswers,
  genres: NamedEntity[],
): number[] {
  const available = new Map<string, number>();
  for (const genre of genres) {
    available.set(normalize(genre.value), genre.id);
  }

  const ids = new Set<number>();
  for (const question of es.onboarding.questions) {
    const option = optionFor(question.id, answers[question.id]);
    if (!option) continue;
    for (const name of option.genres) {
      const id = available.get(normalize(name));
      if (id !== undefined) ids.add(id);
    }
  }
  return [...ids];
}

export function isOnboardingComplete(userId: number): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`) === "done";
  } catch {
    return false;
  }
}

export function markOnboardingComplete(userId: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, "done");
  } catch {
    // Storage can be unavailable in private contexts; the server preferences
    // still prevent the onboarding from appearing again.
  }
}
