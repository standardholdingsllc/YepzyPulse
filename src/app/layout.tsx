import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YepzyPulse",
  description: "Upload Unit transaction CSVs, enrich, and generate shareable reports",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gradient-dark antialiased">
        <header className="border-b border-dark-border bg-dark-bg-secondary/80 backdrop-blur-md sticky top-0 z-50">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white font-bold text-sm shadow-glow-sm">
                Y
              </div>
              <h1 className="text-xl font-semibold text-white">
                YepzyPulse
              </h1>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
        <footer className="border-t border-dark-border mt-auto py-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <p className="text-center text-sm text-muted">
              Files are processed securely. Reports expire after 7 days.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
