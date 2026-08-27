import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** Default edge zone from the top/bottom of the scroll container, in px. */
const EDGE_PX = 64;
/** Clamp autoscroll step within this range, in px/frame. */
const MAX_SPEED_PX = 24;

/** Options for {@link useVerticalDragScroll}. */
export interface AutoScrollOptions {
  /** Trigger zone from the top/bottom edge, in px. Smaller = needs pointer closer to the edge. */
  edgePx?: number;
  /** Maximum scroll step per frame, in px. Controls how fast the edge fling accelerates. */
  maxSpeed?: number;
}

/**
 * Drive a vertical autoscroll during a native drag.
 *
 * HTML5 `DragEvent`s do not autoscroll an overflowing container when the
 * pointer is pinned near the top or bottom edge — the `dragover`/`dragleave`
 * pair only fires while the pointer crosses an element boundary, so a sticky
 * pointer just stops scrolling. To get the "edge fling" behaviour we persist a
 * `mousemove`/`mouseup` pair on `window` and feed an rAF loop with the live
 * pointer Y, stepping the scroll each frame. The scroll container is always
 * read fresh from `ref` so tracking survives re-render.
 *
 * A 2D grid week/day calendar lays events out on a fixed grid with no
 * per-day scrolling columns, so dragging a chip simply needs to keep the rAF
 * autoscroll alive — it does not need to read scroll rects mid-drag.
 */
export function useVerticalDragScroll(
  scrollRef: RefObject<HTMLElement | null>,
  options: AutoScrollOptions = {},
) {
  const { edgePx = EDGE_PX, maxSpeed = MAX_SPEED_PX } = options;

  const frameId = useRef<number | null>(null);
  const isDragging = useRef(false);
  const pointerY = useRef(0);

  // Shared listeners on window for the whole session life.
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    pointerY.current = e.clientY;
  }, []);

  const stopDragging = useCallback(() => {
    isDragging.current = false;
    pointerY.current = 0;
    if (frameId.current !== null) {
      window.cancelAnimationFrame(frameId.current);
      frameId.current = null;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopDragging);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopDragging);
      if (frameId.current !== null) {
        window.cancelAnimationFrame(frameId.current);
        frameId.current = null;
      }
    };
  }, [handleMouseMove, stopDragging]);

  /** Begin the autoscroll loop, seeding the pointer position from `event.clientY`. */
  const begin = useCallback((clientY: number) => {
    if (isDragging.current) return;
    isDragging.current = true;
    pointerY.current = clientY;

    if (frameId.current === null) {
      frameId.current = window.requestAnimationFrame(loop);
    }

    function loop() {
      const el = scrollRef.current;
      if (!el || !isDragging.current) return;

      const rect = el.getBoundingClientRect();
      const distanceFromTop = pointerY.current - rect.top;
      const distanceFromBottom = rect.bottom - pointerY.current;

      // Acceleration factor 0..1: 1 at the very edge, tapering to 0 until the
      // pointer moves out of the edge zone, so there is no scroll while the
      // pointer is inside the container.
      let factor = 0;
      if (distanceFromTop <= edgePx) {
        factor = 1 - distanceFromTop / edgePx;
      } else if (distanceFromBottom <= edgePx) {
        factor = 1 - distanceFromBottom / edgePx;
      }

      const scroll = factor * maxSpeed;
      if (scroll > 0) el.scrollTop += scroll;

      frameId.current = window.requestAnimationFrame(loop);
    }
  }, [edgePx, maxSpeed, scrollRef]);

  /** Stop the autoscroll loop. Safe to call while not dragging. */
  const cancel = useCallback(() => {
    stopDragging();
  }, [stopDragging]);

  return { begin, cancel };
}
