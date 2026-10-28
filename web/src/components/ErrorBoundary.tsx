import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorPage } from '../pages/ErrorPage';

type Props = { children: ReactNode; /** Render the error page as the main landmark (top-level boundary). */ landmark?: boolean };
type State = { reference: string | null };

/** Catches render errors and shows the plain error page with a short reference code. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { reference: null };

  static getDerivedStateFromError(): State {
    return { reference: Date.now().toString(36) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The reference code ties a report from the user to this console entry.
    console.error(`[ref ${this.state.reference ?? Date.now().toString(36)}]`, error, info.componentStack);
  }

  render() {
    if (this.state.reference) return <ErrorPage reference={this.state.reference} landmark={this.props.landmark} />;
    return this.props.children;
  }
}
