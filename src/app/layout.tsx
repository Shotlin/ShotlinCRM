import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../styles.css';
import '../styles-settings.css';
import '../styles-meta.css';
import '../styles-ai.css';

export const metadata: Metadata = {
  title: 'Shotlin CRM',
  description: 'A focused CRM for WhatsApp and Meta enquiries.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
