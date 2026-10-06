/* Substrate gallery — the "browse all" modal opened from the toolbar's
 * compact favorites picker. A centered, backdrop-dimmed grid of cards
 * (square thumbnail / title / description / tag chips). Clicking a card
 * navigates to that substrate (optionally a puzzle/lens variant) and closes.
 *
 * Thumbnails are styled accent-colored placeholders; a card upgrades to a real
 * image as soon as its substrate declares `meta.thumbnail`, and plays
 * `meta.preview` (a muted loop) while hovered or focused — mounted only then,
 * so opening the gallery fetches no clip, and never under reduced motion (S251).
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { LayoutGrid, X } from "lucide-react";
import { galleryCards, SUBSTRATES, type GalleryCard } from "@/app/substrates";
import { selectSubstrate } from "@/app/lib/navigate";
import { session } from "@/app/session";
import { useStore } from "@/app/store";

export function SubstrateGallery() {
  const open = useStore((s) => s.galleryOpen);
  const closeGallery = useStore((s) => s.closeGallery);
  // Re-derive when the roster could have changed under us (boot-time overlay
  // registration is done before first paint, but keep it cheap + reactive to
  // the active selection so the current card reads as selected).
  const sessionVersion = useStore((s) => s.sessionVersion);
  void sessionVersion;

  const cards = useMemo(() => galleryCards(), []);
  const activeId = session.active_substrate_id;

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeGallery();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeGallery]);

  if (!open || typeof document === "undefined") return null;

  function onPick(card: GalleryCard): void {
    selectSubstrate(card.substrateId, {
      ...(card.puzzleId ? { puzzle: card.puzzleId } : {}),
      ...(card.lensId ? { lens: card.lensId } : {}),
    });
    closeGallery();
  }

  const modal = (
    <div
      // Backdrop — click outside the panel to dismiss.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeGallery();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 0",
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        className="glass-heavy"
        style={{
          width: "100%",
          maxHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center gap-2">
            <LayoutGrid size={14} className="text-fg-muted" />
            <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-muted">
              substrates
            </div>
            <span className="chip font-mono">{SUBSTRATES.length}</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            style={{ width: 24, height: 24 }}
            onClick={closeGallery}
            aria-label="Close gallery"
          >
            <X size={12} />
          </button>
        </div>

        {/* Grid */}
        <div
          style={{
            overflow: "auto",
            padding: 16,
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fill, minmax(208px, 1fr))",
            alignContent: "start",
          }}
        >
          {cards.map((card) => (
            <GalleryCardTile
              key={card.key}
              card={card}
              active={card.substrateId === activeId}
              onPick={onPick}
            />
          ))}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function GalleryCardTile({
  card,
  active,
  onPick,
}: {
  card: GalleryCard;
  active: boolean;
  onPick: (card: GalleryCard) => void;
}) {
  const [hot, setHot] = useState(false);
  return (
    <button
      type="button"
      onClick={() => onPick(card)}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
      data-card={card.key}
      className="group"
      style={{
        display: "flex",
        flexDirection: "column",
        textAlign: "left",
        padding: 8,
        borderRadius: 10,
        cursor: "pointer",
        background: active ? "var(--accent-tint)" : "var(--panel-2)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
      }}
    >
      <Thumbnail card={card} hot={hot} />
      <div
        className="font-mono"
        style={{
          marginTop: 8,
          fontSize: "var(--text-sm)",
          color: active ? "var(--accent)" : "var(--fg)",
        }}
      >
        {card.title.toLowerCase()}
      </div>
      {card.description && (
        <div
          className="font-mono leading-snug"
          style={{
            marginTop: 2,
            fontSize: "var(--text-xs)",
            color: "var(--fg-faint)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {card.description}
        </div>
      )}
      <div
        style={{
          marginTop: 8,
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
        }}
      >
        {card.tags.map((tag) => (
          <span key={tag} className="chip font-mono lowercase">
            {tag}
          </span>
        ))}
      </div>
    </button>
  );
}

const reducedMotion = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Square thumbnail — the substrate's image when declared, otherwise a styled
// accent-colored placeholder with the title monogram. While `hot`, a declared
// clip plays over it (its poster is the still, so the swap does not flash).
function Thumbnail({ card, hot }: { card: GalleryCard; hot: boolean }) {
  const play = hot && card.preview !== undefined && !reducedMotion();
  const monogram = card.title.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "1 / 1",
        borderRadius: 8,
        overflow: "hidden",
        background: card.thumbnail
          ? "var(--panel-1)"
          : `linear-gradient(135deg, ${card.accent}33, ${card.accent}0d)`,
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {play ? (
        <video
          src={card.preview}
          {...(card.thumbnail ? { poster: card.thumbnail } : {})}
          autoPlay
          muted
          loop
          playsInline
          aria-label={card.title}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : card.thumbnail ? (
        <img
          src={card.thumbnail}
          alt={card.title}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span
          className="font-mono"
          style={{
            fontSize: 34,
            fontWeight: 600,
            letterSpacing: "0.06em",
            color: card.accent,
            opacity: 0.85,
            userSelect: "none",
          }}
        >
          {monogram}
        </span>
      )}
    </div>
  );
}
