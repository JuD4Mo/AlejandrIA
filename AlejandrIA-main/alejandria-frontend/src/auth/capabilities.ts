import type { Role, User } from "@/api/types";

export type Capability = "read" | "staff" | "admin";

export function hasRole(user: Pick<User, "roles"> | null | undefined, role: Role): boolean {
  return Boolean(user?.roles.includes(role));
}

export function capabilitiesFor(
  user: Pick<User, "roles"> | null | undefined,
): Set<Capability> {
  const capabilities = new Set<Capability>();
  if (!user) return capabilities;
  if (user.roles.includes("lector") || user.roles.includes("administrador")) {
    capabilities.add("read");
  }
  if (
    user.roles.includes("bibliotecario") ||
    user.roles.includes("administrador")
  ) {
    capabilities.add("staff");
  }
  if (user.roles.includes("administrador")) {
    capabilities.add("admin");
  }
  return capabilities;
}

export function canRead(user: Pick<User, "roles"> | null | undefined): boolean {
  return capabilitiesFor(user).has("read");
}

export function canStaff(user: Pick<User, "roles"> | null | undefined): boolean {
  return capabilitiesFor(user).has("staff");
}

export function canAdmin(user: Pick<User, "roles"> | null | undefined): boolean {
  return capabilitiesFor(user).has("admin");
}

export function landingPath(
  user: Pick<User, "roles"> | null | undefined,
): string {
  if (canRead(user)) return "/";
  if (canStaff(user)) return "/staff/requests";
  return "/403";
}

export function roleLabel(role: Role): string {
  return role;
}
