'use client';

import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useActionState } from 'react';
import { loginAction } from './actions';

export function LoginForm() {
  const [error, action, pending] = useActionState(loginAction, null);

  return (
    <form action={action} className="login-form">
      <label className="field">
        <span>Email</span>
        <input name="email" type="email" autoComplete="username" required autoFocus />
      </label>
      <label className="field">
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" required minLength={8} />
      </label>
      {error ? <p className="login-error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary login-submit" disabled={pending}>
        {pending ? <LoaderCircle size={16} className="spin" /> : null}
        {pending ? 'Signing in' : 'Sign in'}
        {!pending ? <ArrowRight size={16} /> : null}
      </button>
    </form>
  );
}
