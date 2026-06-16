'use client';

import { useEffect, useRef, useState } from 'react';
import { getSignedUrlCached } from '@/lib/storageMedia';
import { AppIcon } from './AppIcon';

type Props = {
  bucket: string;
  path: string | null | undefined;
  alt: string;
  className?: string;
  eager?: boolean;
  rootMargin?: string;
  fallbackClassName?: string;
};

export function LazyStorageImage({ bucket, path, alt, className = '', eager = false, rootMargin = '240px', fallbackClassName = '' }: Props) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [shouldLoad, setShouldLoad] = useState(eager);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
  }, [bucket, path]);

  useEffect(() => {
    if (eager || shouldLoad || !containerRef.current) return;
    if (!('IntersectionObserver' in window)) {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [eager, rootMargin, shouldLoad]);

  useEffect(() => {
    let cancelled = false;
    if (!shouldLoad || !path) return;
    void getSignedUrlCached(bucket, path).then((signedUrl) => {
      if (!cancelled) {
        setUrl(signedUrl);
        setFailed(!signedUrl);
      }
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [bucket, path, shouldLoad]);

  return (
    <span ref={containerRef} className={`relative block h-full w-full overflow-hidden bg-slate-100 ${fallbackClassName}`}>
      {url ? <img src={url} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" className={className} /> : (
        <span className="flex h-full w-full items-center justify-center text-slate-300" aria-label={failed ? 'Foto gagal dimuat' : 'Foto sedang dimuat'}>
          <AppIcon name="image" size={28} />
        </span>
      )}
    </span>
  );
}
