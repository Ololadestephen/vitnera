import { LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

export function Status({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad"; children: React.ReactNode }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

export function Busy({ label = "Working" }: { label?: string }) {
  return <span className="busy"><LoaderCircle size={16} /> {label}</span>;
}

export function Notice({ error, message, progress }: { error?: unknown; message?: string; progress?: string }) {
  const [visible, setVisible] = useState(true);
  const errorText = error instanceof Error ? error.message : error ? String(error) : undefined;
  const text = errorText ?? progress ?? message;

  useEffect(() => {
    setVisible(true);
  }, [text]);

  useEffect(() => {
    if (!text || errorText || progress) return undefined;
    const timer = setTimeout(() => setVisible(false), 7000);
    return () => clearTimeout(timer);
  }, [text, errorText, progress]);

  if (!text || !visible) return null;
  return (
    <div className={`notice-toast ${errorText ? "error" : progress ? "progress" : "success"}`} role="status">
      {progress ? <span className="toast-spin"><LoaderCircle size={15} /></span> : <span className="toast-dot" />}
      <span>{text}</span>
      <button aria-label="Dismiss notification" onClick={() => setVisible(false)}>
        <X size={14} />
      </button>
    </div>
  );
}
