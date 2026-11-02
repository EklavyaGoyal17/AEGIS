import Link from 'next/link';
import { Shield } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 px-4 text-center">
      <Shield className="mb-6 h-16 w-16 text-cyan-500/60" />

      <h1 className="text-6xl font-bold tracking-tight text-white">404</h1>
      <h2 className="mt-2 text-xl font-semibold text-neutral-200">Page Not Found</h2>

      <p className="mt-3 text-lg text-neutral-400">
        This page could not be found in the AEGIS console.
      </p>

      <Link
        href="/"
        className="mt-8 inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
      >
        Return to Overview
      </Link>
    </div>
  );
}
