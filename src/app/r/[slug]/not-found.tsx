import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <h2 className="text-2xl font-bold text-gray-900">Report Not Found</h2>
      <p className="mt-2 text-gray-500">
        This report link may be invalid or the report may have been deleted.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-brand-600 px-6 py-2 text-sm font-semibold text-white hover:bg-brand-700"
      >
        Generate a New Report
      </Link>
    </div>
  );
}
