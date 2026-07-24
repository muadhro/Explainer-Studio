import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

export default function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (!user) return null;

  const initials = user.fullName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  async function handleLogout() {
    setOpen(false);
    await logout();
    navigate('/login');
  }

  return (
    <div className="user-menu" ref={rootRef}>
      <button type="button" className="user-menu__trigger" onClick={() => setOpen((v) => !v)}>
        {user.avatarPath ? (
          <img src={user.avatarPath} alt={user.fullName} className="user-menu__avatar-img" />
        ) : (
          <span className="user-menu__avatar">{initials}</span>
        )}
      </button>
      {open && (
        <div className="user-menu__panel">
          <div className="user-menu__info">
            <div className="user-menu__name">{user.fullName}</div>
            <div className="user-menu__email">{user.email}</div>
          </div>
          <button type="button" onClick={() => { setOpen(false); navigate('/account'); }}>
            Account Settings
          </button>
          <button type="button" onClick={() => { setOpen(false); navigate('/pricing'); }}>
            Plans &amp; Billing
          </button>
          <button type="button" className="user-menu__logout" onClick={handleLogout}>
            Log Out
          </button>
        </div>
      )}
    </div>
  );
}
