import { useEffect, useRef, useState } from "react";

type Pos = { x: number | null; y: number | null };

export function useDraggablePanel() {
  const [pos, setPos] = useState<Pos>({ x: null, y: null });
  const dragRef = useRef<{
    mx: number;
    my: number;
    px: number;
    py: number;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const startDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      mx: e.clientX,
      my: e.clientY,
      px: rect.left,
      py: rect.top,
    };
    e.preventDefault();
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.mx;
      const dy = e.clientY - dragRef.current.my;
      // getBoundingClientRect + clientX/Y report visual (post-zoom) pixels;
      // style.left/top are interpreted in pre-zoom CSS pixels. Divide so
      // the panel tracks the cursor 1:1 under the document-root zoom.
      const zoom = parseFloat(document.documentElement.style.zoom) || 1;
      setPos({
        x: (dragRef.current.px + dx) / zoom,
        y: (dragRef.current.py + dy) / zoom,
      });
    };
    const up = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  return { panelRef, startDrag, pos };
}
