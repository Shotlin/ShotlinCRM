import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '@/server/auth/config';
import { CrmBootstrap } from '@/components/layout/CrmBootstrap';
import { AppShell } from '@/components/layout/AppShell';

export default async function CrmLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <CrmBootstrap>
      <AppShell
        user={{
          name: session.user.name ?? 'Owner',
          email: session.user.email ?? '',
        }}
        canReset={process.env.NODE_ENV !== 'production'}
      >
        {children}
      </AppShell>
    </CrmBootstrap>
  );
}
