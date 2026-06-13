import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { reportError } from "../lib/errorReporting";

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, componentStack: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    reportError("react-error-boundary", error, { componentStack: info.componentStack });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ error: null, componentStack: null });
  };

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="error-boundary">
        <div className="error-boundary-panel">
          <AlertTriangle size={32} className="error-boundary-icon" />
          <h1>App ishda xatolik yuz berdi</h1>
          <p className="error-boundary-message">{error.message || "Noma'lum xatolik"}</p>
          <div className="error-boundary-actions">
            <button type="button" onClick={this.handleReload}>
              <RefreshCw size={14} /> Reload
            </button>
            <button type="button" className="ghost" onClick={this.handleReset}>
              Davom etish (xatoga e'tibor bermasdan)
            </button>
          </div>
          {import.meta.env.DEV && (error.stack || componentStack) ? (
            <details className="error-boundary-details">
              <summary>Stack trace</summary>
              {error.stack ? <pre>{error.stack}</pre> : null}
              {componentStack ? <pre>{componentStack}</pre> : null}
            </details>
          ) : null}
        </div>
      </main>
    );
  }
}
