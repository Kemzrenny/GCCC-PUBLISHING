"use client";

import { useRef, useState } from "react";

// A list that can be put in order by dragging a row, or with the up and down buttons
// (which also work on phones and from the keyboard).
export function useReorder<T extends { id: string }>(initial: T[], onChange?: (items: T[]) => void) {
  const [items, setItems] = useState(initial);
  const dragging = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const commit = (next: T[]) => {
    setItems(next);
    onChange?.(next);
  };
  const move = (id: string, by: number) => {
    const i = items.findIndex((x) => x.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const rowProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      dragging.current = id;
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: React.DragEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      setOver(id);
    },
    onDragLeave: () => setOver((o) => (o === id ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const from = dragging.current;
      dragging.current = null;
      setOver(null);
      if (!from || from === id) return;
      const next = items.filter((x) => x.id !== from);
      const moved = items.find((x) => x.id === from)!;
      next.splice(next.findIndex((x) => x.id === id) + (items.findIndex((x) => x.id === from) < items.findIndex((x) => x.id === id) ? 1 : 0), 0, moved);
      commit(next);
    },
    onDragEnd: () => {
      dragging.current = null;
      setOver(null);
    },
    "data-over": over === id ? "true" : undefined,
  });
  return { items, setItems, move, rowProps };
}
