/* NoticeStack — the chrome's surface for notices raised outside React (app/notices.ts): a substrate that could not
 * open says WHY, in the page, until dismissed. */
import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { currentNotices, dismissNotice, subscribeNotices } from "@/app/notices";

export function NoticeStack() {
  const notices = useSyncExternalStore(subscribeNotices, currentNotices);
  if (notices.length === 0) return null;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-20 z-50 flex w-[min(640px,90vw)] -translate-x-1/2 flex-col gap-2" role="alert">
      {notices.map((n) => (
        <div key={n.id} className="flex items-start gap-3 rounded-md border border-red-500/40 bg-neutral-900/95 px-4 py-3 font-mono text-xs text-neutral-200 shadow-lg">
          <div className="flex-1">
            <div className="mb-1 font-semibold text-red-300">{n.title}</div>
            <div className="whitespace-pre-wrap text-neutral-300">{n.body}</div>
          </div>
          <button type="button" aria-label="dismiss" className="text-neutral-400 hover:text-neutral-100" onClick={() => dismissNotice(n.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
