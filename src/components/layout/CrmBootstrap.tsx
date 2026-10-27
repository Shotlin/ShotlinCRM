'use client';

import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/Toast';
import { CrmHydrator } from './CrmHydrator';

export function CrmBootstrap({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <CrmHydrator>{children}</CrmHydrator>
      </ToastProvider>
    </SessionProvider>
  );
}
