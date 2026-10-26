import { useEffect, useRef } from 'react';

export function useAutoScroll(dep) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [dep]);
  return ref;
}
