import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const Context = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "theme";
const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)");

function readSaved(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system"; // storage blocked (private mode, policy): the choice simply is not remembered
  }
}

function resolve(theme: Theme): ResolvedTheme {
  return theme === "system" ? (prefersDark().matches ? "dark" : "light") : theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readSaved);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readSaved()));

  useEffect(() => {
    const apply = () => {
      const next = resolve(theme);
      setResolved(next);
      document.documentElement.classList.toggle("dark", next === "dark");
      document.documentElement.style.colorScheme = next;
    };
    apply();
    if (theme !== "system") return;
    const media = prefersDark();
    media.addEventListener("change", apply); // follow the operating system while the choice is "system"
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* not remembered, still applied */
    }
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
