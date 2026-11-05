"use client";

import { useState } from "react";

/** The voucher code with a one-tap copy button. Without JavaScript the code is still selectable. */
export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex items-stretch overflow-hidden rounded-md border-2 border-dashed border-ink/40">
      <code className="flex-1 px-3 py-2 font-mono text-lg font-bold tracking-wider select-all">
        {code}
      </code>
      <button
        type="button"
        onClick={copy}
        className="bg-lime-400 px-4 text-sm font-bold text-black hover:bg-lime-300"
        aria-label={`Copy code ${code}`}
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}
