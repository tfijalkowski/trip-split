import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  displayName: string | null;
  email: string;
}

export default function ProfileForm({ displayName, email }: Props) {
  const [value, setValue] = useState(displayName ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setError("Name is required");
      return;
    }
    if (trimmed.length > 50) {
      setError("Name must be 50 characters or fewer");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: trimmed }),
      });
      if (res.ok) {
        setSuccess(true);
        setError(null);
        setValue(trimmed);
      } else {
        let message = "Something went wrong. Please try again.";
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          // parse failure — keep default message
        }
        setError(message);
        setSuccess(false);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setSuccess(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm text-white/70">Email</label>
        <p className="text-sm text-white">{email}</p>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm text-white/70" htmlFor="display-name">
          Display name
        </label>
        <input
          id="display-name"
          type="text"
          maxLength={50}
          placeholder="Enter your name"
          value={value}
          disabled={loading}
          onChange={(e) => {
            setValue(e.target.value);
            if (success) setSuccess(false);
          }}
          className={cn(
            "rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-white/50 focus:border-white/40 disabled:opacity-50",
          )}
        />
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? "Saving…" : "Save"}
      </Button>
      {success && <p className="text-sm text-green-300">Name saved</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}
    </form>
  );
}
