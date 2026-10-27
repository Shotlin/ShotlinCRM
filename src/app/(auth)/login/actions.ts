'use server';

import { AuthError } from 'next-auth';
import { signIn } from '@/server/auth/config';

export async function loginAction(_: string | null, formData: FormData): Promise<string | null> {
  try {
    await signIn('credentials', {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      redirectTo: '/',
    });
    return null;
  } catch (error) {
    if (error instanceof AuthError) return 'The email or password is incorrect.';
    throw error;
  }
}
