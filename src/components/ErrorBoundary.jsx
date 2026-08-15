import React from "react";
import { HiExclamationTriangle, HiArrowPath } from "react-icons/hi2";
import { logClientError } from "../services/mvpService";

/**
 * Top-level crash net (doc §96-98 "monitoring"). Without this, a render
 * error anywhere in the tree unmounts the whole app to a blank white
 * screen -- no error is visible to the user or logged anywhere. Reports to
 * error_logs via logClientError() (fire-and-forget, never throws back into
 * this already-broken render) and shows a real recovery action instead of
 * a dead page.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    logClientError(error?.message || String(error), {
      stack: error?.stack,
      severity: "fatal",
      context: { componentStack: info?.componentStack?.slice(0, 4000) },
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="state-view state-error" role="alert" style={{ minHeight: "100vh", justifyContent: "center" }}>
          <span className="state-icon"><HiExclamationTriangle /></span>
          <h3>Something went wrong</h3>
          <p>This has been reported. Reloading usually fixes it.</p>
          <button className="ghost" onClick={() => window.location.reload()}>
            <HiArrowPath /> Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
