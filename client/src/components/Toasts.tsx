import { useEffect } from "react";
import type { Toast } from "../core/useRoomCore";

interface Props {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 4000);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);
  return (
    <div className={`toast ${toast.kind}`} onClick={() => onDismiss(toast.id)}>
      {toast.message}
    </div>
  );
}

export default function Toasts({ toasts, onDismiss }: Props) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
