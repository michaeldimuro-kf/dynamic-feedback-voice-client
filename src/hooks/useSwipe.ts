import { useState, useEffect, RefObject } from 'react';

type Direction = 'up' | 'down' | 'left' | 'right' | null;

interface SwipeOptions {
  threshold?: number;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

export function useSwipe<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { 
    threshold = 50, 
    onSwipeUp, 
    onSwipeDown, 
    onSwipeLeft, 
    onSwipeRight 
  }: SwipeOptions = {}
) {
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const [touchEnd, setTouchEnd] = useState<{ x: number; y: number } | null>(null);
  const [direction, setDirection] = useState<Direction>(null);

  // Reset values when component unmounts
  useEffect(() => {
    return () => {
      setTouchStart(null);
      setTouchEnd(null);
      setDirection(null);
    };
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleTouchStart = (e: Event) => {
      const touchEvent = e as TouchEvent;
      setTouchEnd(null);
      setDirection(null);
      setTouchStart({
        x: touchEvent.targetTouches[0].clientX,
        y: touchEvent.targetTouches[0].clientY,
      });
    };

    const handleTouchMove = (e: Event) => {
      const touchEvent = e as TouchEvent;
      setTouchEnd({
        x: touchEvent.targetTouches[0].clientX,
        y: touchEvent.targetTouches[0].clientY,
      });
    };

    const handleTouchEnd = () => {
      if (!touchStart || !touchEnd) return;
      
      const distanceX = touchStart.x - touchEnd.x;
      const distanceY = touchStart.y - touchEnd.y;
      const isHorizontalSwipe = Math.abs(distanceX) > Math.abs(distanceY);
      
      // Determine swipe direction
      if (isHorizontalSwipe) {
        if (distanceX > threshold) {
          setDirection('left');
          onSwipeLeft?.();
        } else if (distanceX < -threshold) {
          setDirection('right');
          onSwipeRight?.();
        }
      } else {
        if (distanceY > threshold) {
          setDirection('up');
          onSwipeUp?.();
        } else if (distanceY < -threshold) {
          setDirection('down');
          onSwipeDown?.();
        }
      }
      
      // Reset touch coordinates
      setTouchStart(null);
      setTouchEnd(null);
    };

    element.addEventListener('touchstart', handleTouchStart as EventListener);
    element.addEventListener('touchmove', handleTouchMove as EventListener);
    element.addEventListener('touchend', handleTouchEnd);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart as EventListener);
      element.removeEventListener('touchmove', handleTouchMove as EventListener);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [ref, touchStart, touchEnd, threshold, onSwipeUp, onSwipeDown, onSwipeLeft, onSwipeRight]);

  return { direction };
}

export default useSwipe; 
