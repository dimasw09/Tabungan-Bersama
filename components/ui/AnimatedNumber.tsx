'use client';

import { useEffect, useRef, useState } from 'react';
import { rupiah } from '@/lib/format';

interface AnimatedNumberProps {
  value: number;
  formatter?: (value: number) => string;
  duration?: number;
  className?: string;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function AnimatedNumber({ value, formatter = (current) => Math.round(current).toLocaleString('id-ID'), duration = 900, className = '' }: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValue = useRef(value);

  useEffect(() => {
    const from = previousValue.current;
    previousValue.current = value;

    if (prefersReducedMotion() || from === value) {
      setDisplayValue(value);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const difference = value - from;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(from + difference * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, value]);

  return <span className={className}>{formatter(displayValue)}</span>;
}

export function AnimatedRupiah({ value, duration = 900, className = '' }: Omit<AnimatedNumberProps, 'formatter'>) {
  return <AnimatedNumber value={value} duration={duration} className={className} formatter={(current) => rupiah(Math.round(current))} />;
}
