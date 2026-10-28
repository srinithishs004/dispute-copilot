import { Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './lib/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Footer } from './components/Footer';
import { ToastProvider } from './components/Toast';
import { TopBar } from './components/TopBar';
import { WakingUpGate } from './components/WakingUp';
import { Guide } from './pages/Guide';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { NotFound } from './pages/NotFound';
import { Dashboard } from './pages/Dashboard';
import { Privacy } from './pages/Privacy';
import { Review } from './pages/Review';
import { Terms } from './pages/Terms';

function Layout() {
  const { pathname } = useLocation();
  return (
    // The dashboard uses a wider column; the top bar and footer follow it so edges line up.
    <div className={pathname === '/dashboard' ? 'shell shell--wide' : 'shell'}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar />
      <main id="main" className="shell__main" tabIndex={-1}>
        {/* Keyed by path so one broken page does not stick after navigating away. */}
        <ErrorBoundary key={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <Footer />
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary landmark>
      <WakingUpGate>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="guide" element={<Guide />} />
                <Route path="login" element={<Login />} />
                <Route
                  path="dashboard"
                  element={
                    <RequireAuth>
                      <Dashboard />
                    </RequireAuth>
                  }
                />
                <Route
                  path="disputes/:id"
                  element={
                    <RequireAuth>
                      <Review />
                    </RequireAuth>
                  }
                />
                <Route path="privacy" element={<Privacy />} />
                <Route path="terms" element={<Terms />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </WakingUpGate>
    </ErrorBoundary>
  );
}
