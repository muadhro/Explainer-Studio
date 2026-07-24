import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import Upload from './pages/Upload';
import Dashboard from './pages/Dashboard';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <nav className="app-nav">
          <div className="app-nav__inner">
            <span className="app-nav__brand">Explainer&nbsp;Studio</span>
            <div className="app-nav__links">
              <NavLink to="/upload" className={({ isActive }) => (isActive ? 'active' : '')}>
                Create
              </NavLink>
              <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'active' : '')}>
                Library
              </NavLink>
            </div>
          </div>
        </nav>
        <main>
          <Routes>
            <Route path="/" element={<Navigate to="/upload" replace />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/dashboard" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
