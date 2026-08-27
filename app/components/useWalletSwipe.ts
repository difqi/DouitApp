"use client";

import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";

type GestureState = {
  startX: number;
  startY: number;
  axis: "horizontal" | "vertical" | null;
};

type WalletSwipeOptions = {
  itemCount: number;
  selectedIndex: number;
  onSelect: (index: number) => void;
};

export function useWalletSwipe({ itemCount, selectedIndex, onSelect }: WalletSwipeOptions) {
  const [dragOffset, setDragOffset] = useState(0);
  const gestureRef = useRef<GestureState | null>(null);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (itemCount < 2 || (event.target as HTMLElement).closest("button")) return;
    gestureRef.current = { startX: event.clientX, startY: event.clientY, axis: null };
  }, [itemCount]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const horizontalDistance = Math.abs(deltaX);
    const verticalDistance = Math.abs(deltaY);

    if (!gesture.axis && Math.max(horizontalDistance, verticalDistance) > 8) {
      if (verticalDistance > horizontalDistance) {
        gesture.axis = "vertical";
      } else if (horizontalDistance > verticalDistance * 1.2) {
        gesture.axis = "horizontal";
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    }

    if (gesture.axis === "horizontal") {
      event.preventDefault();
      const isAtStart = selectedIndex === 0 && deltaX > 0;
      const isAtEnd = selectedIndex === itemCount - 1 && deltaX < 0;
      setDragOffset((isAtStart || isAtEnd) ? deltaX * 0.28 : deltaX);
    }
  }, [itemCount, selectedIndex]);

  const finishPointerGesture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.axis === "horizontal") {
      const deltaX = event.clientX - gesture.startX;
      if (deltaX <= -52 && selectedIndex < itemCount - 1) onSelect(selectedIndex + 1);
      if (deltaX >= 52 && selectedIndex > 0) onSelect(selectedIndex - 1);
    }
    gestureRef.current = null;
    setDragOffset(0);
  }, [itemCount, onSelect, selectedIndex]);

  return {
    dragOffset,
    handlePointerDown,
    handlePointerMove,
    finishPointerGesture,
  };
}
