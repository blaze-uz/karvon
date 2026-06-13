import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { applyThemePreference } from "./lib/theme";
import { installGlobalErrorHandlers } from "./lib/errorReporting";
import "./styles.css";

installGlobalErrorHandlers();
applyThemePreference("system");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
