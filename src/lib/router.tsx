'use client';

import NextLink from 'next/link';
import { useParams as useNextParams, usePathname, useRouter } from 'next/navigation';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string;
  children: ReactNode;
};

export function Link({ to, children, ...props }: LinkProps) {
  return (
    <NextLink href={to} {...props}>
      {children}
    </NextLink>
  );
}

type NavLinkProps = Omit<LinkProps, 'className'> & {
  className?: string | ((state: { isActive: boolean }) => string);
  end?: boolean;
};

export function NavLink({ to, className, end, children, ...props }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  return (
    <NextLink
      href={to}
      className={typeof className === 'function' ? className({ isActive }) : className}
      aria-current={isActive ? 'page' : undefined}
      {...props}
    >
      {children}
    </NextLink>
  );
}

export function useNavigate() {
  const router = useRouter();
  return (target: string) => router.push(target);
}

export function useParams<T extends Record<string, string>>() {
  return useNextParams() as T;
}

export { usePathname };
