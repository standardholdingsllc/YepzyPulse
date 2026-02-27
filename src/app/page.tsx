import { UploadForm } from "@/components/upload-form";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-gray-900">
          Transaction Report Generator
        </h2>
        <p className="mt-3 text-base text-gray-600">
          Upload a Unit transaction CSV export and an employer mapping JSON to generate
          an interactive, shareable report with remittance analysis and US location detection.
        </p>
      </div>
      <UploadForm />
    </div>
  );
}
