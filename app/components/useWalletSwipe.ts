"use client";

import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
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

type WalletCarouselOptions = WalletSwipeOptions;

export function useWalletCarousel({ itemCount, selectedIndex, onSelect }: WalletCarouselOptions) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const programmaticTargetRef = useRef<number | null>(null);
  const previousItemCountRef = useRef(0);

  const getScrollTarget = useCallback((index: number) => {
    const carousel = carouselRef.current;
    const card = carousel?.children.item(index) as HTMLElement | null;
    if (!carousel || !card) return null;

    const centeredLeft = card.offsetLeft - ((carousel.clientWidth - card.offsetWidth) / 2);
    return Math.max(0, Math.min(centeredLeft, carousel.scrollWidth - carousel.clientWidth));
  }, []);

  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior = "smooth") => {
    if (index < 0 || index >= itemCount) return;
    const targetLeft = getScrollTarget(index);
    if (targetLeft === null || !carouselRef.current) return;

    programmaticTargetRef.current = index;
    carouselRef.current.scrollTo({ left: targetLeft, behavior });
  }, [getScrollTarget, itemCount]);

  const handleScroll = useCallback(() => {
    const carousel = carouselRef.current;
    if (!carousel || itemCount < 2) return;
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      const programmaticTarget = programmaticTargetRef.current;
      if (programmaticTarget !== null) {
        const targetLeft = getScrollTarget(programmaticTarget);
        if (targetLeft !== null && Math.abs(carousel.scrollLeft - targetLeft) <= 2) {
          programmaticTargetRef.current = null;
        }
        return;
      }

      const viewportCenter = carousel.scrollLeft + (carousel.clientWidth / 2);
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      Array.from(carousel.children).forEach((child, index) => {
        const card = child as HTMLElement;
        const cardCenter = card.offsetLeft + (card.offsetWidth / 2);
        const distance = Math.abs(cardCenter - viewportCenter);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      if (nearestIndex !== selectedIndex) onSelect(nearestIndex);
    });
  }, [getScrollTarget, itemCount, onSelect, selectedIndex]);

  const beginUserInteraction = useCallback(() => {
    programmaticTargetRef.current = null;
  }, []);

  useEffect(() => {
    if (itemCount === previousItemCountRef.current) return;
    previousItemCountRef.current = itemCount;
    const frame = window.requestAnimationFrame(() => scrollToIndex(selectedIndex, "auto"));
    return () => window.cancelAnimationFrame(frame);
  }, [itemCount, scrollToIndex, selectedIndex]);

  useEffect(() => {
    const alignSelectedCard = () => scrollToIndex(selectedIndex, "auto");
    window.addEventListener("resize", alignSelectedCard);
    return () => window.removeEventListener("resize", alignSelectedCard);
  }, [scrollToIndex, selectedIndex]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  return {
    carouselRef,
    handleScroll,
    beginUserInteraction,
    scrollToIndex,
  };
}
