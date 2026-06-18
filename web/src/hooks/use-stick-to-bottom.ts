import { useEffect, useRef, useState } from "react";

/**
 * Keep a scroll container pinned to its live bottom while new content streams
 * in, releasing only on a genuine user scroll-up. Shared by the chat view and
 * the task-progress view so both follow identical logic.
 *
 * Follow state is *intent*, not a raw position read: it flips false only when
 * the user actively scrolls UP, never just because content grew below them. On
 * a long stream the bottom races ahead as roughly one event per frame commits;
 * a programmatic pin's own scroll event then reads an already-grown
 * scrollHeight, computes "not at bottom", and — under a position-only check —
 * would latch follow off, stranding the view at the top. Tracking scroll
 * *direction* instead keeps us pinned through that growth.
 *
 * @param deps     values whose change can grow the content (messages, a
 *                 thinking indicator); each commit re-pins while following.
 * @param resetKey an identity that, when it changes, snaps back to the bottom
 *                 and re-engages follow (opening/switching a session or task).
 * @param onScrollExtra optional hook-in run on every scroll with the live
 *                 container, after follow state is updated. Lets a caller layer
 *                 on scroll-driven behaviour (e.g. growing a tail window when
 *                 the user nears the top) without owning the scroll handler.
 */
export function useStickToBottom(
  deps: unknown[],
  resetKey?: unknown,
  onScrollExtra?: (el: HTMLDivElement) => void,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastTopRef = useRef(0);
  const [showJump, setShowJump] = useState(false);

  // Jump straight to the bottom (instant, not smooth: the content can be tens
  // of thousands of px tall and a smooth scroll over that feels sluggish).
  const pinToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastTopRef.current = el.scrollTop;
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const atBottom = el.scrollHeight - top - el.clientHeight < 80;
    // Reaching the bottom re-engages follow; only a genuine upward scroll
    // (scrollTop actually decreased) releases it. A "not at bottom" that comes
    // from content growing below us — scrollTop unchanged — must NOT release,
    // or streaming output would strand the reader at the top.
    if (atBottom) stickRef.current = true;
    else if (top < lastTopRef.current - 2) stickRef.current = false;
    lastTopRef.current = top;
    // Show the jump button only when following is off AND there's content below.
    setShowJump(!stickRef.current && el.scrollHeight - el.clientHeight > 120);
    onScrollExtra?.(el);
  };

  const scrollToBottom = () => {
    stickRef.current = true;
    setShowJump(false);
    pinToBottom();
  };

  // Follow the bottom as content grows — streaming tokens, replayed history, a
  // late-loading <img>, or cv-auto messages re-laying-out to their real height.
  // A ResizeObserver catches every height change, including ones that don't
  // change a dep's identity. Pinning only moves scrollTop (not the observed
  // size), so it can't loop.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) pinToBottom();
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  // Belt-and-suspenders: also pin on each React commit while following.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (stickRef.current) pinToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Opening/switching a session or task should land at the latest line, not the
  // top: re-engage follow and pin.
  useEffect(() => {
    stickRef.current = true;
    setShowJump(false);
    pinToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  return { scrollRef, contentRef, showJump, onScroll, scrollToBottom };
}
