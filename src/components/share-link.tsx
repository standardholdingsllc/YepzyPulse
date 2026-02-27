"use client";

import { useState } from "react";

export function ShareLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  const url = typeof window !== "undefined"
    ? `${window.location.origin}/r/${slug}`
    : `/r/${slug}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-lg border border-dark-border bg-dark-bg-tertiary px-3 py-2">
        <span className="text-xs text-muted mr-2">Share:</span>
        <code className="text-xs font-mono text-accent">/r/{slug}</code>
      </div>
      <button
        onClick={handleCopy}
        className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
          copied
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            : "border-dark-border bg-dark-bg-secondary text-white hover:bg-dark-bg-tertiary hover:border-accent/50"
        }`}
      >
        {copied ? "✓ Copied!" : "Copy Link"}
      </button>
    </div>
  );
}
