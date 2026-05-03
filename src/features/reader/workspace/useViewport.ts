import { useEffect, useState } from 'react';

export type Viewport = 'desktop' | 'mobile';

const QUERY = '(min-width: 768px)';

function read(): Viewport {
  if (typeof window === 'undefined') return 'desktop';
  return window.matchMedia(QUERY).matches ? 'desktop' : 'mobile';
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(read);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (): void => {
      setViewport(mq.matches ? 'desktop' : 'mobile');
    };
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
    };
  }, []);
  return viewport;
}
