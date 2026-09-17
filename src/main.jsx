import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installStorage } from './storage.js';
import PersonalCRM from './PersonalCRM.jsx';

// Must run before the app mounts — PersonalCRM reads window.storage on its
// first effect.
installStorage();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PersonalCRM />
  </StrictMode>,
);
