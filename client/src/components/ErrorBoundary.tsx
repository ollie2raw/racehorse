import * as Sentry from '@sentry/react';
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { DefaultErrorFallback } from './DefaultErrorFallback';
import { logger } from '../utils/logger';
import { recoverFromChunkLoadFailure } from '../debug/moduleImportRecovery';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  context?: string;
  resetHandler?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const label = this.props.context ?? 'unknown';

    // A lazy chunk that will not load after a deploy breaks this subtree and
    // nothing else can fix it from here. One reload fetches a fresh entry
    // HTML. Runs before logging so a recovered load is not also an alert.
    if (recoverFromChunkLoadFailure(error) === 'reloaded') return;

    logger.error('ErrorBoundary.tsx', error, { label, componentStack: info.componentStack });
    Sentry.captureException(error, { extra: { label, componentStack: info.componentStack } });
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <DefaultErrorFallback
          error={this.state.error}
          onReset={this.props.resetHandler ?? this.reset}
        />
      );
    }
    return this.props.children;
  }
}
