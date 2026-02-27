import { UploadForm } from "@/components/upload-form";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-10 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-white">
          Transaction Report Generator
        </h2>
        <p className="mt-4 text-base text-muted leading-relaxed">
          Upload a Unit transaction CSV and generate an interactive, shareable report 
          with remittance analysis and US location detection.
        </p>
      </div>
      <UploadForm />
    </div>
  );
}
