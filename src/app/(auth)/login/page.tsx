import { redirect } from 'next/navigation';
import { auth } from '@/server/auth/config';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect('/');

  return (
    <main className="login-page">
      <section className="login-brand-panel" aria-label="Shotlin CRM">
        <div className="login-brand-top">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>Shotlin CRM</span>
        </div>
        <div className="login-brand-copy">
          <p className="eyebrow">CRM for personal studios</p>
          <h1>Every enquiry. One clear next step.</h1>
          <p>
            Conversations, proposals, payments, and follow-ups in a private workspace that
            stays out of the way.
          </p>
        </div>
        <p className="login-brand-foot">WhatsApp linked device · Meta lead capture</p>
      </section>

      <section className="login-form-panel">
        <div className="login-form-inner">
          <p className="eyebrow">Welcome back</p>
          <h2>Sign in to your workspace</h2>
          <p className="login-subtitle">Your CRM data is private to this account.</p>
          <LoginForm />
          <p className="login-note">
            This application uses an unofficial WhatsApp linked-device connection. Your phone
            keeps its existing WhatsApp account and can unlink this device at any time.
          </p>
        </div>
      </section>
    </main>
  );
}
