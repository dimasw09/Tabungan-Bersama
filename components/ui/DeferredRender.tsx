'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

export function DeferredRender({ children, minHeight = 260, rootMargin = '320px' }: { children: ReactNode; minHeight?: number; rootMargin?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible || !ref.current) return;
    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [rootMargin, visible]);

  return <div ref={ref} style={!visible ? { minHeight } : undefined}>{visible ? children : <div className="h-full min-h-[inherit] animate-pulse rounded-3xl bg-slate-100/80" aria-label="Bagian akan dimuat saat terlihat" />}</div>;
}
