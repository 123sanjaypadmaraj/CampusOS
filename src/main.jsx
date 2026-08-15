import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { logClientError } from "./services/mvpService";

// Global crash net (doc §96-98 "monitoring"), in-house rather than a
// third-party account -- see supabase/migrations/20260814005200_error_logs.sql.
// Catches what an ErrorBoundary structurally can't: errors thrown outside
// React's render (event handlers, timers, non-React libraries) and
// unhandled promise rejections (a `.catch`-less async call anywhere).
window.addEventListener("error", (event) => {
  logClientError(event.message || "Uncaught error", {
    stack: event.error?.stack,
    severity: "error",
    context: { filename: event.filename, lineno: event.lineno, colno: event.colno },
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  logClientError(reason?.message || String(reason), {
    stack: reason?.stack,
    severity: "error",
    context: { type: "unhandledrejection" },
  });
});

// Single shared TanStack Query client for all server-state fetching (doc §4
// Option B). Individual features configure their own staleTime/retry via
// their query hooks; these are just sane cross-app defaults.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
