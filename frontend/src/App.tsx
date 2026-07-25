import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { ThemeProvider } from './ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import UserMenu from './components/UserMenu';
import ThemeToggle from './components/ThemeToggle';
import Home from './pages/Home';
import Upload from './pages/Upload';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Pricing from './pages/Pricing';
import Account from './pages/Account';
import Admin from './pages/Admin';
import Contact from './pages/Contact';
import Legal from './pages/Legal';

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
          <NavLink to="/contact" className={({ isActive }) => (isActive ? 'active' : '')}>
            Contact
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>
              Admin
            </NavLink>
          )}
        </div>
        <div className="app-nav__auth">
          <ThemeToggle />
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
        <ThemeProvider>
          <div className="app-shell">
            <Nav />
            <main>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/contact" element={<Contact />} />
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
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute adminOnly>
                      <Admin />
                    </ProtectedRoute>
                  }
                />
              </Routes>
            </main>
          </div>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
