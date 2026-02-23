import { getSocketTrace } from './socketTrace';

export function installGlobalErrorHandlers() {
  window.addEventListener('error', (e) => {
    console.error('Global error:', e.error ?? e.message);
    console.error('Last socket events:', getSocketTrace());
  });

  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled rejection:', e.reason);
    console.error('Last socket events:', getSocketTrace());
  });
}
