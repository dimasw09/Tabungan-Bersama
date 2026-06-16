'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export function useProgressiveList<T>(items: T[], pageSize = 8, resetKeys: readonly unknown[] = []) {
  const [visibleCount, setVisibleCount] = useState(pageSize);

  useEffect(() => {
    setVisibleCount(pageSize);
    // resetKeys intentionally controls when filters/tabs reset the visible window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, ...resetKeys]);

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const hasMore = visibleCount < items.length;
  const loadMore = useCallback(() => setVisibleCount((count) => Math.min(count + pageSize, items.length)), [items.length, pageSize]);

  return { visibleItems, visibleCount, hasMore, loadMore, remaining: Math.max(items.length - visibleCount, 0) };
}
