import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="page not-found-page">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p>The page you were looking for does not exist in this workspace.</p>
      <Link href="/" className="btn btn-primary">
        Return to overview
      </Link>
    </div>
  );
}
