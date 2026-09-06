// Admin entrypoint (T007). Consumes ONLY the admin surface of @ijazah/contracts. Mandatory MFA arrives in Phase 1.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';

// index.html always ships this element; its absence is a broken build, not a runtime branch.
const container = document.getElementById('root');
if (container === null) throw new Error('Admin root element is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
