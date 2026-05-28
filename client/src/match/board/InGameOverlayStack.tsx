import type { ReactNode } from 'react';

export interface InGameOverlayStackProps {
  children?: ReactNode;
}

export function InGameOverlayStack({ children }: InGameOverlayStackProps) {
  return <>{children}</>;
}
