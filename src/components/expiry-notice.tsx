"use client";

import { useMemo } from "react";

interface ExpiryNoticeProps {
  expiresAt: string;
}

export function ExpiryNotice({ expiresAt }: ExpiryNoticeProps) {
  const { daysRemaining, isExpiringSoon, formattedDate } = useMemo(() => {
    const expiryDate = new Date(expiresAt);
    const now = new Date();
    const diffMs = expiryDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    return {
      daysRemaining: diffDays,
      isExpiringSoon: diffDays <= 2,
      formattedDate: expiryDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    };
  }, [expiresAt]);

  if (daysRemaining <= 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Report expired
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium ${
        isExpiringSoon
          ? "bg-amber-100 text-amber-700"
          : "bg-gray-100 text-gray-600"
      }`}
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>
        Expires {daysRemaining === 1 ? "tomorrow" : `in ${daysRemaining} days`}
        <span className="ml-1 text-gray-400">({formattedDate})</span>
      </span>
    </div>
  );
}
