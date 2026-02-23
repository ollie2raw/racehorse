import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installGlobalErrorHandlers } from "./debug/globalErrors";
import './index.css';
import App from './App.tsx';
import './styles/walnut-live.css';

{installGlobalErrorHandlers();}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
