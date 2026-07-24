import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import UserMenu from './components/UserMenu';
import Home from './pages/Home';
import Upload from './pages/Upload';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Pricing from './pages/Pricing';
import Account from './pages/Account';
import Legal from './pages/Legal';

function ThemeSync() {
  const { user } = useAuth();

  useEffect(() => {
    const preferred = user?.theme || 'system';
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    function apply() {
      const resolved = preferred === 'system' ? (media.matches ? 'dark' : 'light') : preferred;
      document.documentElement.dataset.theme = resolved;
    }

    apply();
    if (preferred === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
  }, [user?.theme]);

  return null;
}

function Nav() {
  const { user, loading } = useAuth();

  return (
    <nav className="app-nav">
      <div className="app-nav__inner">
        <NavLink to="/" className="app-nav__brand">
          Explainer&nbsp;Studio
        </NavLink>
        <div className="app-nav__links">
          {user && (
            <>
              <NavLink to="/upload" className={({ isActive }) => (isActive ? 'active' : '')}>
                Create
              </NavLink>
              <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'active' : '')}>
                Library
              </NavLink>
            </>
          )}
          <NavLink to="/pricing" className={({ isActive }) => (isActive ? 'active' : '')}>
            Pricing
          </NavLink>
        </div>
        <div className="app-nav__auth">
          {loading ? null : user ? (
            <UserMenu />
          ) : (
            <>
              <NavLink to="/login" className="nav-button nav-button--ghost">
                Log In
              </NavLink>
              <NavLink to="/signup" className="nav-button nav-button--solid">
                Sign Up
              </NavLink>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeSync />
        <div className="app-shell">
          <Nav />
          <main>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/terms" element={<Legal title="Terms of Service" />} />
              <Route path="/privacy" element={<Legal title="Privacy Policy" />} />
              <Route
                path="/upload"
                element={
                  <ProtectedRoute>
                    <Upload />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/account"
                element={
                  <ProtectedRoute>
                    <Account />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </main>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
