export const PASSWORD_MIN_CHARACTERS = 12;
export const PASSWORD_MAX_BYTES = 72;

export function passwordByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function passwordCharacterLength(value: string): number {
  return Array.from(value).length;
}

export type PasswordProblem = "tooShort" | "tooLong" | null;

export function passwordProblem(value: string): PasswordProblem {
  if (passwordCharacterLength(value) < PASSWORD_MIN_CHARACTERS) {
    return "tooShort";
  }
  if (passwordByteLength(value) > PASSWORD_MAX_BYTES) {
    return "tooLong";
  }
  return null;
}

export function passwordIsValid(value: string): boolean {
  return passwordProblem(value) === null;
}
