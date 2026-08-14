import { LoaderCircle } from "lucide-react";

export function Status({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad"; children: React.ReactNode }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

export function Busy({ label = "Working" }: { label?: string }) {
  return <span className="busy"><LoaderCircle size={16} /> {label}</span>;
}

export function Notice({ error, message }: { error?: unknown; message?: string }) {
  if (!error && !message) return null;
  return <div className={error ? "notice error" : "notice success"}>{error instanceof Error ? error.message : error ? String(error) : message}</div>;
}
