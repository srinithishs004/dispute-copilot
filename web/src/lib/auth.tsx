import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, UnauthorizedError } from './api';

export type Role = 'owner' | 'judge';
export type User = { email: string; role: Role };

type AuthState = {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    api<User>('/auth/me')
      .then((u) => live && setUser(u))
      .catch(() => live && setUser(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const u = await api<User>('/auth/login', { method: 'POST', json: { email, password } });
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (err) {
      // Already signed out on the server is fine; anything else should surface.
      if (!(err instanceof UnauthorizedError)) throw err;
    }
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Where to go after sign-in: only same-origin paths, never back to /login. */
export function safeNext(next: string | null | undefined): string {
  const fallback = '/dashboard';
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) return fallback;
  return next;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="page" aria-busy="true" aria-label="Loading">
        <div className="k-skel skel-title" />
        <div className="k-skel skel-block" />
      </div>
    );
  }
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}
