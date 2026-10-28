'use client';

import {
  CalendarDays,
  ChartNoAxesCombined,
  FileSignature,
  FileText,
  FolderKanban,
  HardDrive,
  Landmark,
  LayoutDashboard,
  MessageSquareText,
  ReceiptText,
  Settings2,
  Sparkles,
  SquareKanban,
  Users,
  Wallet,
} from 'lucide-react';
import { signOut } from 'next-auth/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link, NavLink, usePathname } from '../../lib/router';
import { Avatar } from '../ui/Avatar';
import { StorageBanner } from './StorageBanner';
import { useToast } from '../ui/Toast';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/ai', label: 'AI assistant', icon: Sparkles },
  { to: '/pipeline', label: 'Pipeline', icon: SquareKanban },
  { to: '/inbox', label: 'Inbox', icon: MessageSquareText },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/proposals', label: 'Proposals', icon: FileText },
  { to: '/agreements', label: 'Agreements', icon: FileSignature },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/invoices', label: 'Invoices', icon: ReceiptText },
  { to: '/finance', label: 'Finance', icon: ChartNoAxesCombined },
  { to: '/gst', label: 'GST returns', icon: Landmark },
  { to: '/expenses', label: 'Expenses', icon: Wallet },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
];

export function AppShell({
  children,
  user,
  canReset,
}: {
  children: ReactNode;
  user: { name: string; email: string };
  canReset: boolean;
}) {
  const { notify } = useToast();
  const [resetting, setResetting] = useState(false);
  // The inbox is a full-screen chat app, so the shell shrinks to a slim icon rail.
  const chatMode = usePathname().startsWith('/inbox');

  const resetData = async () => {
    if (!window.confirm('Replace all workspace records with the demo data? This cannot be undone.')) {
      return;
    }
    setResetting(true);
    try {
      const response = await fetch('/api/crm/reset', { method: 'POST' });
      if (!response.ok) throw new Error('Reset failed');
      window.location.reload();
    } catch {
      notify('Could not reset the workspace');
      setResetting(false);
    }
  };

  return (
    <div className={`app-shell${chatMode ? ' app-shell--chat' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">S</span>
          <div className="brand-copy">
            <span className="brand-name">Shotlin CRM</span>
            <span className="brand-caption">Client operations</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}
              title={label}
              aria-label={label}
            >
              <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="side-footer">
          <p className="demo-note">
            <span className="demo-dot" aria-hidden="true" />
            Private workspace
          </p>
          <details className="profile-menu">
            <summary className="profile-summary">
              <Avatar name={user.name} size="sm" />
              <span className="profile-copy">
                <strong>{user.name}</strong>
                <small>{user.email}</small>
              </span>
              <span className="profile-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="profile-popover">
              <Link to="/settings/integrations" className="profile-action">
                <Settings2 size={14} /> Integrations
              </Link>
              <Link to="/settings/storage" className="profile-action">
                <HardDrive size={14} /> Storage
              </Link>
              <Link to="/settings/ai" className="profile-action">
                <Sparkles size={14} /> AI settings
              </Link>
              <Link to="/settings/templates" className="profile-action">
                <MessageSquareText size={14} /> Message templates
              </Link>
              {canReset ? (
                <button type="button" className="profile-action" disabled={resetting} onClick={resetData}>
                  {resetting ? 'Resetting…' : 'Reset demo workspace'}
                </button>
              ) : null}
              <button type="button" className="profile-action" onClick={() => signOut({ callbackUrl: '/login' })}>
                Sign out
              </button>
            </div>
          </details>
        </div>
      </aside>

      <main className="main-canvas">
        {chatMode ? null : <StorageBanner />}
        {children}
      </main>
    </div>
  );
}
