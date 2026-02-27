import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="rounded-full bg-dark-bg-tertiary p-4 mb-4">
        <svg className="h-8 w-8 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-white">Report Not Found</h2>
      <p className="mt-2 text-muted">
        This report link may be invalid or the report may have expired.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-glow-sm hover:bg-accent-hover transition-all"
      >
        Generate a New Report
      </Link>
    </div>
  );
}
