import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './design-system/tokens.css';
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
