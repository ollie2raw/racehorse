import { createContext } from 'react';

export type RouteChromeHints = {
  activeColor?: string;
  compactChrome?: boolean;
  solidDarkChrome?: boolean;
};

/** Existing route nav call sites supply styling hints while the app shell owns the only live chrome. */
export const RouteChromeOwnedContext = createContext<((hints: RouteChromeHints | null) => void) | null>(null);
