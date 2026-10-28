import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, RequireAuth, safeNext } from './auth';
import { Login } from '../pages/Login';
import { ToastProvider } from '../components/Toast';
import { json, mockFetch } from '../test/http';

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderAt(path: string) {
  return render(
    <ToastProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/login" element={<><Login /><Where /></>} />
            <Route
              path="/disputes/:id"
              element={
                <RequireAuth>
                  <h1>Secret review</h1>
                  <Where />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </ToastProvider>,
  );
}

async function signIn() {
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'judge@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('RequireAuth', () => {
  it('redirects a signed-out visitor to /login with the return path', async () => {
    mockFetch(() => json(401, { error: 'unauthorized' }));
    renderAt('/disputes/42?tab=letter');
    const where = await screen.findByTestId('where');
    expect(where.textContent).toBe(`/login?next=${encodeURIComponent('/disputes/42?tab=letter')}`);
    expect(screen.queryByText('Secret review')).toBeNull();
  });

  it('renders the page when signed in', async () => {
    mockFetch(() => json(200, { email: 'judge@example.com', role: 'judge' }));
    renderAt('/disputes/42');
    expect(await screen.findByText('Secret review')).toBeTruthy();
  });
});

describe('Login', () => {
  it('navigates to next after a successful sign-in', async () => {
    let signedIn = false;
    const fetch = mockFetch((url, init) => {
      if (url === '/auth/me') return signedIn ? json(200, { email: 'judge@example.com', role: 'judge' }) : json(401, {});
      if (url === '/auth/login' && init?.method === 'POST') {
        signedIn = true;
        return json(200, { email: 'judge@example.com', role: 'judge' });
      }
      return json(404, {});
    });
    renderAt(`/login?next=${encodeURIComponent('/disputes/42')}`);
    await signIn();
    expect(await screen.findByText('Secret review')).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('/disputes/42');
    const loginCall = fetch.mock.calls.find(([u]) => u === '/auth/login')!;
    expect(loginCall[1]!.body).toBe(JSON.stringify({ email: 'judge@example.com', password: 'pw' }));
  });

  it('ignores an off-site next and goes to /dashboard', async () => {
    mockFetch((url) =>
      url === '/auth/login' ? json(200, { email: 'judge@example.com', role: 'judge' }) : json(401, {}),
    );
    renderAt(`/login?next=${encodeURIComponent('//evil.example/x')}`);
    await signIn();
    await screen.findByText('/dashboard');
  });

  it('shows a plain message for wrong credentials and keeps the user on the page', async () => {
    mockFetch((url) => (url === '/auth/login' ? json(401, { error: 'invalid email or password' }) : json(401, {})));
    renderAt('/login');
    await signIn();
    expect((await screen.findByRole('alert')).textContent).toMatch(/do not match/i);
  });

  it('explains the rate limit on 429', async () => {
    mockFetch((url) =>
      url === '/auth/login' ? json(429, { error: 'too many attempts, try again later' }) : json(401, {}),
    );
    renderAt('/login');
    await signIn();
    expect((await screen.findByRole('alert')).textContent).toMatch(/too many attempts/i);
  });

  it('says sign-in is not set up on 503', async () => {
    mockFetch((url) => (url === '/auth/login' ? json(503, { error: 'login is not configured' }) : json(401, {})));
    renderAt('/login');
    await signIn();
    expect((await screen.findByRole('alert')).textContent).toMatch(/not set up on this server/i);
  });
});

describe('safeNext', () => {
  it.each([
    ['/disputes/1', '/disputes/1'],
    ['/dashboard?x=1#y', '/dashboard?x=1#y'],
    [null, '/dashboard'],
    ['', '/dashboard'],
    ['//evil.example', '/dashboard'],
    ['/\\evil.example', '/dashboard'],
    ['https://evil.example', '/dashboard'],
    ['javascript:alert(1)', '/dashboard'],
    ['/login', '/dashboard'],
  ])('%s -> %s', (input, out) => {
    expect(safeNext(input)).toBe(out);
  });
});
