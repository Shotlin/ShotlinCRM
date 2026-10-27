import { and, eq } from 'drizzle-orm';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { db } from '../db/client';
import { users, workspaceMembers, workspaces } from '../db/schema';
import { createLoginThrottle } from './loginThrottle';
import { verifyPassword } from './password';

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(256),
});

const loginThrottle = createLoginThrottle();

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        if (!loginThrottle.allow(email)) return null;

        const [account] = await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            passwordHash: users.passwordHash,
            workspaceId: workspaces.id,
            workspaceName: workspaces.name,
            role: workspaceMembers.role,
          })
          .from(users)
          .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
          .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
          .where(eq(users.email, email))
          .limit(1);

        if (!account || !(await verifyPassword(account.passwordHash, password))) {
          loginThrottle.recordFailure(email);
          return null;
        }
        loginThrottle.reset(email);

        return {
          id: account.id,
          name: account.name,
          email: account.email,
          workspaceId: account.workspaceId,
          workspaceName: account.workspaceName,
          role: account.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.workspaceId = user.workspaceId;
        token.workspaceName = user.workspaceName;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId as string;
      session.user.workspaceId = token.workspaceId as string;
      session.user.workspaceName = token.workspaceName as string;
      session.user.role = token.role as string;
      return session;
    },
  },
});

export async function getAuthContext() {
  const session = await auth();
  if (!session?.user?.workspaceId || !session.user.id) return null;
  const role = await requireWorkspaceAccess(session.user.id, session.user.workspaceId);
  if (!role) return null;
  return {
    userId: session.user.id,
    workspaceId: session.user.workspaceId,
    workspaceName: session.user.workspaceName,
    role,
  };
}

export async function requireWorkspaceAccess(userId: string, workspaceId: string) {
  const [membership] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);
  return membership?.role ?? null;
}
