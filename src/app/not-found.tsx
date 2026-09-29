import Link from "next/link";

export default function NotFound() {
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-ink-muted">We couldn&apos;t find what you were looking for.</p>
      <Link href="/deals" className="font-medium text-brand-600 hover:underline">
        Browse the latest deals
      </Link>
    </section>
  );
}
