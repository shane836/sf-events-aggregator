import Link from "next/link";

export function EmptyState() {
  return (
    <div
      data-testid="empty-state"
      className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-12 text-center"
    >
      <p className="max-w-md text-sm text-zinc-400">
        No events match those filters. Try widening your date range or clearing
        a category.
      </p>
      <Link
        href="/"
        scroll={false}
        className="inline-flex min-h-[44px] items-center rounded-md bg-zinc-100 px-4 text-sm font-medium text-zinc-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
      >
        Reset filters
      </Link>
    </div>
  );
}
