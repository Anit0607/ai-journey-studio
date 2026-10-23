/** Persisted scope, not an integration permission. Missing metadata is historical v0. */
export const ALL_PLATFORMS = ["LinkedIn", "X", "Instagram"] as const;
export type ActivePlatform = typeof ALL_PLATFORMS[number];
export type PlatformPolicy = {version: 1; platforms: readonly ["LinkedIn"]};
export const NEW_PLATFORM_POLICY: PlatformPolicy = Object.freeze({version: 1, platforms: Object.freeze(["LinkedIn"] as const)});
export const NEW_PLATFORMS = NEW_PLATFORM_POLICY.platforms;

export function readPlatformPolicy(value: unknown): PlatformPolicy | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid persisted platform policy");
  const policy = value as Record<string, unknown>;
  if (Object.keys(policy).length !== 2 || policy.version !== 1 || !Array.isArray(policy.platforms) || policy.platforms.length !== 1 || policy.platforms[0] !== "LinkedIn") throw Error("Invalid persisted platform policy");
  return NEW_PLATFORM_POLICY;
}
export function activePlatforms(policy?: PlatformPolicy): readonly ActivePlatform[] {
  return readPlatformPolicy(policy)?.platforms || ALL_PLATFORMS;
}
export function taskPlatformPolicy(task?: {content_brief?: Record<string, unknown>}): PlatformPolicy | undefined {
  const brief = task?.content_brief;
  const policy = readPlatformPolicy(brief?.platform_policy);
  if (policy && (JSON.stringify(brief?.platforms) !== JSON.stringify(policy.platforms))) throw Error("Invalid persisted platform policy");
  return policy;
}
export function newTaskPlatformBrief() {
  return {platform_policy: NEW_PLATFORM_POLICY, platforms: [...NEW_PLATFORMS]};
}
export function calendarPlatformPolicy(entry: {platform_schedule?: Record<string, unknown>}): PlatformPolicy | undefined {
  const schedule = entry.platform_schedule || {};
  const policy = readPlatformPolicy(schedule.platform_policy);
  if (policy && (Object.keys(schedule).some(key => !["platform_policy", "LinkedIn"].includes(key)) || !schedule.LinkedIn)) throw Error("Invalid persisted platform policy");
  return policy;
}
