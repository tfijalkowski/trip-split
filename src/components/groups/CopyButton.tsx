import { useState } from "react";

interface Props {
  value: string;
}

export default function CopyButton({ value }: Props) {
  const [copied, setCopied] = useState(false);

  function handleClick() {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    });
  }

  return (
    <button
      onClick={handleClick}
      className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white transition-colors hover:bg-white/20"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
