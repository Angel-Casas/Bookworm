import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './design-system/tokens.css';
import './design-system/motion.css';
import './design-system/reset.css';

import { App } from '@/app/App';
import { checkCapabilities } from '@/shared/capabilities';
import { UnsupportedBrowser } from '@/shared/UnsupportedBrowser';
import { registerServiceWorker } from '@/pwa/register-sw';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Bookworm: root element #root not found in index.html.');
}

const capabilities = checkCapabilities();

if (import.meta.env.DEV) {
  // Phase 6 audit: runtime a11y violation logger (dev-only).
  // Dynamic import keeps this out of production bundles.
  void (async () => {
    const [React, ReactDOM, { default: reactAxe }] = await Promise.all([
      import('react'),
      import('react-dom'),
      import('@axe-core/react'),
    ]);
    await reactAxe(React, ReactDOM, 1000);
  })();
}

createRoot(rootEl).render(
  <StrictMode>
    {capabilities.kind === 'supported' ? (
      <App />
    ) : (
      <UnsupportedBrowser missing={capabilities.missing} />
    )}
  </StrictMode>,
);

if (capabilities.kind === 'supported') {
  registerServiceWorker();
}
