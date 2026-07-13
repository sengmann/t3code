import type { DesktopBridge } from "@t3tools/contracts";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useSyncExternalStore } from "react";

export const THEME_VALUES = [
  "light",
  "dark",
  "system",
  "catppuccin-latte",
  "catppuccin-frappe",
  "catppuccin-macchiato",
  "catppuccin-mocha",
] as const;
export const SYSTEM_LIGHT_THEME_VALUES = ["light", "catppuccin-latte"] as const;
export const SYSTEM_DARK_THEME_VALUES = [
  "dark",
  "catppuccin-frappe",
  "catppuccin-macchiato",
  "catppuccin-mocha",
] as const;
export const DEFAULT_SYSTEM_LIGHT_THEME = "light" satisfies SystemLightTheme;
export const DEFAULT_SYSTEM_DARK_THEME = "dark" satisfies SystemDarkTheme;

const ThemePreference = Schema.Literals(THEME_VALUES);
const DesktopThemePreference = Schema.Literals(["light", "dark", "system"]);
export type Theme = (typeof THEME_VALUES)[number];
export type SystemLightTheme = (typeof SYSTEM_LIGHT_THEME_VALUES)[number];
export type SystemDarkTheme = (typeof SYSTEM_DARK_THEME_VALUES)[number];
type ResolvedTheme = "light" | "dark";
type ThemeSnapshot = {
  theme: Theme;
  systemDark: boolean;
  systemLightTheme: SystemLightTheme;
  systemDarkTheme: SystemDarkTheme;
};

type DesktopThemeBridge = Pick<DesktopBridge, "setTheme">;
type DesktopTheme = typeof DesktopThemePreference.Type;

const STORAGE_KEY = "t3code:theme";
const SYSTEM_LIGHT_THEME_STORAGE_KEY = "t3code:theme:system-light";
const SYSTEM_DARK_THEME_STORAGE_KEY = "t3code:theme:system-dark";
const THEME_STORAGE_KEYS = new Set([
  STORAGE_KEY,
  SYSTEM_LIGHT_THEME_STORAGE_KEY,
  SYSTEM_DARK_THEME_STORAGE_KEY,
]);
const MEDIA_QUERY = "(prefers-color-scheme: dark)";
const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = {
  theme: "system",
  systemDark: false,
  systemLightTheme: DEFAULT_SYSTEM_LIGHT_THEME,
  systemDarkTheme: DEFAULT_SYSTEM_DARK_THEME,
};
const THEME_COLOR_META_NAME = "theme-color";
const DYNAMIC_THEME_COLOR_SELECTOR = `meta[name="${THEME_COLOR_META_NAME}"][data-dynamic-theme-color="true"]`;

export class ThemeStorageError extends Schema.TaggedErrorClass<ThemeStorageError>()(
  "ThemeStorageError",
  {
    operation: Schema.Literals(["read", "write"]),
    storageKey: Schema.String,
    theme: Schema.optional(ThemePreference),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} theme preference for ${this.storageKey}.`;
  }
}

export const isThemeStorageError = Schema.is(ThemeStorageError);

export class DesktopThemeSyncError extends Schema.TaggedErrorClass<DesktopThemeSyncError>()(
  "DesktopThemeSyncError",
  {
    theme: DesktopThemePreference,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to sync the ${this.theme} theme to the desktop shell.`;
  }
}

export const isDesktopThemeSyncError = Schema.is(DesktopThemeSyncError);

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let lastDesktopTheme: DesktopTheme | null = null;
let lastAppliedTheme: ThemeSnapshot | null = null;
let themeStorageReadFailure: ThemeStorageError | null = null;

function emitChange() {
  for (const listener of listeners) listener();
}

function getSystemDark() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MEDIA_QUERY).matches
  );
}

export function isThemePreference(value: string): value is Theme {
  return THEME_VALUES.includes(value as Theme);
}

export function isSystemLightThemePreference(value: string): value is SystemLightTheme {
  return SYSTEM_LIGHT_THEME_VALUES.includes(value as SystemLightTheme);
}

export function isSystemDarkThemePreference(value: string): value is SystemDarkTheme {
  return SYSTEM_DARK_THEME_VALUES.includes(value as SystemDarkTheme);
}

export function resolveEffectiveTheme(
  theme: Theme,
  systemDark: boolean,
  systemLightTheme: SystemLightTheme = DEFAULT_SYSTEM_LIGHT_THEME,
  systemDarkTheme: SystemDarkTheme = DEFAULT_SYSTEM_DARK_THEME,
): Exclude<Theme, "system"> {
  if (theme !== "system") return theme;
  return systemDark ? systemDarkTheme : systemLightTheme;
}

export function resolveThemeAppearance(
  theme: Theme,
  systemDark: boolean,
  systemLightTheme: SystemLightTheme = DEFAULT_SYSTEM_LIGHT_THEME,
  systemDarkTheme: SystemDarkTheme = DEFAULT_SYSTEM_DARK_THEME,
): ResolvedTheme {
  const effectiveTheme = resolveEffectiveTheme(
    theme,
    systemDark,
    systemLightTheme,
    systemDarkTheme,
  );
  switch (theme) {
    case "system":
      return resolveThemeAppearance(effectiveTheme, false);
    case "dark":
    case "catppuccin-frappe":
    case "catppuccin-macchiato":
    case "catppuccin-mocha":
      return "dark";
    case "light":
    case "catppuccin-latte":
      return "light";
  }
}

export function resolveDesktopThemePreference(
  theme: Theme,
  systemDark: boolean,
  systemLightTheme: SystemLightTheme = DEFAULT_SYSTEM_LIGHT_THEME,
  systemDarkTheme: SystemDarkTheme = DEFAULT_SYSTEM_DARK_THEME,
): DesktopTheme {
  return theme === "system"
    ? "system"
    : resolveThemeAppearance(theme, systemDark, systemLightTheme, systemDarkTheme);
}

function readPreference<T extends Theme>(
  storageKey: string,
  isValid: (value: string) => value is T,
  fallback: T,
): T {
  if (typeof window === "undefined") return fallback;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "read",
      storageKey,
      cause,
    });
  }
  if (raw !== null && isValid(raw)) return raw;
  return fallback;
}

function writePreference(storageKey: string, theme: Theme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, theme);
    themeStorageReadFailure = null;
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "write",
      storageKey,
      theme,
      cause,
    });
  }
}

export function readThemePreference(): Theme {
  return readPreference(STORAGE_KEY, isThemePreference, DEFAULT_THEME_SNAPSHOT.theme);
}

export function readSystemLightThemePreference(): SystemLightTheme {
  return readPreference(
    SYSTEM_LIGHT_THEME_STORAGE_KEY,
    isSystemLightThemePreference,
    DEFAULT_SYSTEM_LIGHT_THEME,
  );
}

export function readSystemDarkThemePreference(): SystemDarkTheme {
  return readPreference(
    SYSTEM_DARK_THEME_STORAGE_KEY,
    isSystemDarkThemePreference,
    DEFAULT_SYSTEM_DARK_THEME,
  );
}

export function writeThemePreference(theme: Theme): void {
  writePreference(STORAGE_KEY, theme);
}

export function writeSystemLightThemePreference(theme: SystemLightTheme): void {
  writePreference(SYSTEM_LIGHT_THEME_STORAGE_KEY, theme);
}

export function writeSystemDarkThemePreference(theme: SystemDarkTheme): void {
  writePreference(SYSTEM_DARK_THEME_STORAGE_KEY, theme);
}

function getStored(): Omit<ThemeSnapshot, "systemDark"> {
  if (themeStorageReadFailure !== null) {
    return DEFAULT_THEME_SNAPSHOT;
  }
  try {
    return {
      theme: readThemePreference(),
      systemLightTheme: readSystemLightThemePreference(),
      systemDarkTheme: readSystemDarkThemePreference(),
    };
  } catch (cause) {
    const error = isThemeStorageError(cause)
      ? cause
      : new ThemeStorageError({
          operation: "read",
          storageKey: STORAGE_KEY,
          cause,
        });
    themeStorageReadFailure = error;
    console.error(error.message, {
      operation: error.operation,
      storageKey: error.storageKey,
      ...safeErrorLogAttributes(error),
    });
    return DEFAULT_THEME_SNAPSHOT;
  }
}

function ensureThemeColorMetaTag(): HTMLMetaElement {
  let element = document.querySelector<HTMLMetaElement>(DYNAMIC_THEME_COLOR_SELECTOR);
  if (element) {
    return element;
  }

  element = document.createElement("meta");
  element.name = THEME_COLOR_META_NAME;
  element.setAttribute("data-dynamic-theme-color", "true");
  document.head.append(element);
  return element;
}

function normalizeThemeColor(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim().toLowerCase();
  if (
    !normalizedValue ||
    normalizedValue === "transparent" ||
    normalizedValue === "rgba(0, 0, 0, 0)" ||
    normalizedValue === "rgba(0 0 0 / 0)"
  ) {
    return null;
  }

  return value?.trim() ?? null;
}

function resolveBrowserChromeSurface(): HTMLElement {
  return (
    document.querySelector<HTMLElement>("main[data-slot='sidebar-inset']") ??
    document.querySelector<HTMLElement>("[data-slot='sidebar-inner']") ??
    document.body
  );
}

export function syncBrowserChromeTheme() {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return;
  const surfaceColor = normalizeThemeColor(
    getComputedStyle(resolveBrowserChromeSurface()).backgroundColor,
  );
  const fallbackColor = normalizeThemeColor(getComputedStyle(document.body).backgroundColor);
  const backgroundColor = surfaceColor ?? fallbackColor;
  if (!backgroundColor) return;

  document.documentElement.style.backgroundColor = backgroundColor;
  document.body.style.backgroundColor = backgroundColor;
  ensureThemeColorMetaTag().setAttribute("content", backgroundColor);
}

function applyTheme(snapshot: Omit<ThemeSnapshot, "systemDark">, suppressTransitions = false) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const systemDark = snapshot.theme === "system" ? getSystemDark() : false;
  const resolvedTheme = resolveThemeAppearance(
    snapshot.theme,
    systemDark,
    snapshot.systemLightTheme,
    snapshot.systemDarkTheme,
  );
  const effectiveTheme = resolveEffectiveTheme(
    snapshot.theme,
    systemDark,
    snapshot.systemLightTheme,
    snapshot.systemDarkTheme,
  );
  const desktopTheme = resolveDesktopThemePreference(
    snapshot.theme,
    systemDark,
    snapshot.systemLightTheme,
    snapshot.systemDarkTheme,
  );
  if (
    lastAppliedTheme?.theme === snapshot.theme &&
    lastAppliedTheme.systemDark === systemDark &&
    lastAppliedTheme.systemLightTheme === snapshot.systemLightTheme &&
    lastAppliedTheme.systemDarkTheme === snapshot.systemDarkTheme
  ) {
    syncDesktopTheme(desktopTheme);
    return;
  }

  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }
  document.documentElement.setAttribute?.("data-theme", effectiveTheme);
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  lastAppliedTheme = { ...snapshot, systemDark };
  syncBrowserChromeTheme();
  syncDesktopTheme(desktopTheme);
  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal
    // oxlint-disable-next-line no-unused-expressions
    document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  }
}

export async function syncDesktopThemePreference(
  bridge: DesktopThemeBridge,
  theme: DesktopTheme,
): Promise<void> {
  try {
    await bridge.setTheme(theme);
  } catch (cause) {
    throw new DesktopThemeSyncError({ theme, cause });
  }
}

export function syncDesktopTheme(theme: DesktopTheme) {
  if (typeof window === "undefined") return;
  const bridge = window.desktopBridge;
  if (!bridge || typeof bridge.setTheme !== "function" || lastDesktopTheme === theme) {
    return;
  }

  lastDesktopTheme = theme;
  void syncDesktopThemePreference(bridge, theme).catch((cause: unknown) => {
    const error = isDesktopThemeSyncError(cause)
      ? cause
      : new DesktopThemeSyncError({ theme, cause });
    console.error(error.message, {
      theme: error.theme,
      ...safeErrorLogAttributes(error),
    });
    if (lastDesktopTheme === theme) {
      lastDesktopTheme = null;
    }
  });
}

// Apply immediately on module load to prevent flash
if (typeof document !== "undefined" && typeof window !== "undefined") {
  applyTheme(getStored());
}

function getSnapshot(): ThemeSnapshot {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT;
  const stored = getStored();
  const systemDark = stored.theme === "system" ? getSystemDark() : false;

  if (
    lastSnapshot &&
    lastSnapshot.theme === stored.theme &&
    lastSnapshot.systemDark === systemDark &&
    lastSnapshot.systemLightTheme === stored.systemLightTheme &&
    lastSnapshot.systemDarkTheme === stored.systemDarkTheme
  ) {
    return lastSnapshot;
  }

  lastSnapshot = { ...stored, systemDark };
  return lastSnapshot;
}

function getServerSnapshot() {
  return DEFAULT_THEME_SNAPSHOT;
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.push(listener);

  // Listen for system preference changes
  const mq = typeof window.matchMedia === "function" ? window.matchMedia(MEDIA_QUERY) : null;
  const handleChange = () => {
    const stored = getStored();
    if (stored.theme === "system") applyTheme(stored, true);
    emitChange();
  };
  mq?.addEventListener("change", handleChange);

  // Listen for storage changes from other tabs
  const handleStorage = (e: StorageEvent) => {
    if (e.key !== null && THEME_STORAGE_KEYS.has(e.key)) {
      themeStorageReadFailure = null;
      applyTheme(getStored(), true);
      emitChange();
    }
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    listeners = listeners.filter((l) => l !== listener);
    mq?.removeEventListener("change", handleChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const theme = snapshot.theme;

  const resolvedTheme = resolveThemeAppearance(
    theme,
    snapshot.systemDark,
    snapshot.systemLightTheme,
    snapshot.systemDarkTheme,
  );

  const setTheme = useCallback((next: Theme) => {
    if (typeof window === "undefined") return;
    try {
      writeThemePreference(next);
    } catch (cause) {
      const error = isThemeStorageError(cause)
        ? cause
        : new ThemeStorageError({
            operation: "write",
            storageKey: STORAGE_KEY,
            theme: next,
            cause,
          });
      console.error(error.message, {
        operation: error.operation,
        storageKey: error.storageKey,
        theme: next,
        ...safeErrorLogAttributes(error),
      });
      return;
    }
    applyTheme({ ...getStored(), theme: next }, true);
    emitChange();
  }, []);

  const setSystemLightTheme = useCallback((next: SystemLightTheme) => {
    if (typeof window === "undefined") return;
    try {
      writeSystemLightThemePreference(next);
    } catch (cause) {
      const error = isThemeStorageError(cause)
        ? cause
        : new ThemeStorageError({
            operation: "write",
            storageKey: SYSTEM_LIGHT_THEME_STORAGE_KEY,
            theme: next,
            cause,
          });
      console.error(error.message, {
        operation: error.operation,
        storageKey: error.storageKey,
        theme: next,
        ...safeErrorLogAttributes(error),
      });
      return;
    }
    applyTheme({ ...getStored(), systemLightTheme: next }, true);
    emitChange();
  }, []);

  const setSystemDarkTheme = useCallback((next: SystemDarkTheme) => {
    if (typeof window === "undefined") return;
    try {
      writeSystemDarkThemePreference(next);
    } catch (cause) {
      const error = isThemeStorageError(cause)
        ? cause
        : new ThemeStorageError({
            operation: "write",
            storageKey: SYSTEM_DARK_THEME_STORAGE_KEY,
            theme: next,
            cause,
          });
      console.error(error.message, {
        operation: error.operation,
        storageKey: error.storageKey,
        theme: next,
        ...safeErrorLogAttributes(error),
      });
      return;
    }
    applyTheme({ ...getStored(), systemDarkTheme: next }, true);
    emitChange();
  }, []);

  // Keep DOM in sync on mount/change
  useEffect(() => {
    applyTheme(snapshot);
  }, [snapshot]);

  return {
    theme,
    setTheme,
    resolvedTheme,
    systemLightTheme: snapshot.systemLightTheme,
    setSystemLightTheme,
    systemDarkTheme: snapshot.systemDarkTheme,
    setSystemDarkTheme,
  } as const;
}
