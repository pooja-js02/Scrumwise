import React from 'react';
import { createRoot } from 'react-dom/client';
// The typeface is bundled with the app, so it loads without the internet and never flashes a fallback.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@scrumwise/ui/styles.css';
import { App } from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
