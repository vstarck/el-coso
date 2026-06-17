/* Scoped error boundary. Wraps "replaceable units" — surfaces where a
   render-time crash should degrade locally (placeholder UI) rather than
   tear down the whole React root. Keep blanket usage out; a top-level
   boundary would mask real bugs. */

import { Component, type ReactNode } from "react";

type Props = {
  fallback: ReactNode;
  children: ReactNode;
  label?: string;
};

type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ""}]`, err);
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}
