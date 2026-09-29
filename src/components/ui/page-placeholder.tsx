/** Heading block for routes whose content is built in a later stage (see docs/ARCHITECTURE.md §13). */
export function PagePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
      <p className="max-w-prose text-ink-muted">{description}</p>
      <p className="text-sm text-ink-muted">This page is under construction.</p>
    </section>
  );
}
