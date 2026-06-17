// Tail-windowing for the message list.
//
// Long transcripts are rendered window-first: only the last `count` messages
// are mounted, so opening a big session builds ~`count` DOM nodes instead of the
// whole history and lands at the latest message instantly. Scrolling near the
// top grows `count`, revealing older messages in place.

/** Return the last `count` items of `items` (or all of them when fewer exist). */
export function tailWindow<T>(items: readonly T[], count: number): T[] {
  if (count <= 0) return [];
  if (items.length <= count) return items.slice();
  return items.slice(items.length - count);
}

/** How many items sit above the window — i.e. are hidden by `tailWindow`. */
export function hiddenAbove(total: number, count: number): number {
  if (count <= 0) return Math.max(0, total);
  return Math.max(0, total - count);
}
