import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ThemeSwitch } from './ThemeSwitch';
import { useToast } from './Toast';

const ROLE_LABEL = { owner: 'Owner', judge: 'Judge' } as const;

export function TopBar() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const onLogin = useLocation().pathname === '/login';
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      navigate('/');
    } catch {
      toast.show({ title: 'Could not sign out', body: 'Check your connection and try again.', tone: 'danger' });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <header className="topbar">
      <div className="topbar__inner">
        <Link to="/" className="topbar__brand k-wordmark t-wordmark-sm" aria-label="Dispute Copilot, home">
          Dispute Copilot
        </Link>

        <div className="topbar__nav">
          <nav aria-label="Main">
            <ul className="nav-links">
              {user ? (
                <li>
                  <NavLink to="/dashboard" className="nav-link">
                    Dashboard
                  </NavLink>
                </li>
              ) : (
                <>
                  <li>
                    <NavLink to="/guide" className="nav-link">
                      Guide
                    </NavLink>
                  </li>
                  <li>
                    <a href="/store" className="nav-link">
                      Store
                    </a>
                  </li>
                </>
              )}
            </ul>
          </nav>
          {user ? (
            <span className="k-badge k-badge--plain role-badge" title={user.email}>
              {ROLE_LABEL[user.role] ?? user.role}
            </span>
          ) : null}
        </div>

        <div className="topbar__actions">
          <ThemeSwitch />
          {loading ? (
            <span className="k-skel topbar__auth-skel" aria-hidden="true" />
          ) : user ? (
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={signOut} disabled={signingOut}>
              Sign out
            </button>
          ) : onLogin ? null : (
            <Link to="/login" className="k-btn k-btn--sm">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
