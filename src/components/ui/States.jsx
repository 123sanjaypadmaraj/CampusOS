import React from "react";
import { HiExclamationTriangle, HiWifi, HiInboxStack, HiArrowPath, HiArrowDownTray, HiXMark } from "react-icons/hi2";

/**
 * Shared loading/empty/error/offline building blocks (doc §82) so a screen
 * never just renders blank while data is missing -- every state has
 * something a user can look at and, where relevant, act on.
 */

export function LoadingState({ label = "Loading…" }) {
  return (
    <div className="state-view state-loading" role="status" aria-live="polite">
      <span className="state-spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }) {
  return (
    <div className="state-view state-empty">
      <span className="state-icon">{icon || <HiInboxStack />}</span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", text, onRetry }) {
  return (
    <div className="state-view state-error" role="alert">
      <span className="state-icon"><HiExclamationTriangle /></span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {onRetry && (
        <button className="ghost" onClick={onRetry}>
          <HiArrowPath /> Try again
        </button>
      )}
    </div>
  );
}

export function OfflineBanner({ online }) {
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <HiWifi /> You&rsquo;re offline — showing cached content. Orders, bookings and posting need a connection.
    </div>
  );
}

/** Custom install-prompt banner (doc §80) -- shown in place of relying on
 * the browser's own install UI, which most browsers suppress by default
 * once `beforeinstallprompt` is intercepted (see useInstallPrompt). Only
 * rendered once `canInstall` is true, so this stays invisible on browsers/
 * platforms (iOS Safari, an already-installed app) that never offer it. */
export function InstallPromptBanner({ canInstall, onInstall, onDismiss }) {
  if (!canInstall) return null;
  return (
    <div className="offline-banner install-banner" role="status">
      <HiArrowDownTray aria-hidden="true" />
      <span>Install CampusOS for faster access and offline support.</span>
      <button type="button" className="install-banner-cta" onClick={onInstall}>
        Install
      </button>
      <button type="button" className="install-banner-dismiss" onClick={onDismiss} aria-label="Dismiss install prompt">
        <HiXMark aria-hidden="true" />
      </button>
    </div>
  );
}
