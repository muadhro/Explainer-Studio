import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { updatePreferences } from './api';

type ThemeSetting = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemeSetting;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeSetting) => void;
  toggleTheme: () => void;
}

const LOCAL_KEY = 'explainer-studio-theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemeSetting(value: string | null): value is ThemeSetting {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  const [localTheme, setLocalTheme] = useState<ThemeSetting>(() => {
    const stored = localStorage.getItem(LOCAL_KEY);
    return isThemeSetting(stored) ? stored : 'system';
  });
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  // Signed-in users' preference lives on their account; signed-out visitors
  // get a per-browser fallback so the toggle still works pre-login.
  const theme: ThemeSetting = user ? user.theme : localTheme;
  const resolvedTheme: ResolvedTheme = theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = useCallback(
    (next: ThemeSetting) => {
      if (user) {
        updatePreferences({ theme: next }).then(setUser).catch(() => {});
      } else {
        localStorage.setItem(LOCAL_KEY, next);
        setLocalTheme(next);
      }
    },
    [user, setUser],
  );

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
