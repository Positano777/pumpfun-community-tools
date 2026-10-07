import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-28 text-center">
      <div className="font-mono text-6xl font-extrabold text-signal">404</div>
      <p className="mt-3 text-muted">Nothing to see here. Not even a rug.</p>
      <Link href="/" className="btn-primary mt-8">Back to the scanner</Link>
    </div>
  );
}
