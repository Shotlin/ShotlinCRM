import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface User {
    workspaceId: string;
    workspaceName: string;
    role: string;
  }

  interface Session {
    user: {
      id: string;
      workspaceId: string;
      workspaceName: string;
      role: string;
    } & DefaultSession['user'];
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    userId?: string;
    workspaceId?: string;
    workspaceName?: string;
    role?: string;
  }
}
