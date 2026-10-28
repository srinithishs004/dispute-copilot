import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/kaala/tokens.css';
import './styles/kaala/kaala.css';
import './styles/app.css';
import { App } from './App';
import { applyTheme, getInitialTheme } from './lib/theme';

// theme-init.js already did this before paint; repeat in case it was blocked.
applyTheme(getInitialTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
