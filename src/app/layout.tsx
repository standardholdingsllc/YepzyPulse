import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yepzy Transaction Processor",
  description: "Upload Unit transaction CSVs, enrich, and generate shareable reports",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 antialiased">
        <header className="border-b bg-white shadow-sm">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white font-bold text-sm">
                Y
              </div>
              <h1 className="text-xl font-semibold text-gray-900">
                Yepzy Transaction Processor
              </h1>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
