import { useId, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { safeNext, useAuth } from '../lib/auth';
import { usePageTitle } from '../lib/usePageTitle';

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'That email and password do not match. Check them and try again.';
    if (err.status === 429) return 'Too many attempts. Wait a few minutes, then try again.';
    if (err.status === 503) return 'Sign-in is not set up on this server yet.';
    if (err.status === 400) return 'Enter your email and password.';
  }
  return 'Could not reach the server. Try again in a moment.';
}

export function Login() {
  usePageTitle('Sign in');
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorId = useId();

  if (user && !submitting) return <Navigate to={next} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(messageFor(err));
      setSubmitting(false);
    }
  };

  const invalid = error !== null;

  return (
    <div className="page page--narrow login">
      <div className="k-card login__card">
        <header className="login__head">
          <h1 className="t-h1">Sign in</h1>
          <p className="t-body muted">
            Judges: the login is on the <Link to="/guide">judge guide</Link>.
          </p>
        </header>
        <form className="login__form" onSubmit={onSubmit} noValidate>
          <div className="k-field">
            <label className="k-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className={`k-input${invalid ? ' k-input--error' : ''}`}
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
              required
            />
          </div>
          <div className="k-field">
            <label className="k-label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className={`k-input${invalid ? ' k-input--error' : ''}`}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
              required
            />
            {error ? (
              <p id={errorId} className="k-help k-help--error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <button type="submit" className="k-btn k-btn--primary k-btn--lg login__submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
