import { useEffect } from "react";
import { registerNativePushListeners } from "../services/pushService";

function usePushDeepLinks({ go, goToConversation, notify }) {
  const routeNotificationAction = (actionType, actionId) => {
      if (!actionType || !actionId) return;
      if (actionType === "conversation") {
        goToConversation(actionId);
      } else {
        go("notifications");
      }
    };

  useEffect(() => {
      const params = new URLSearchParams(window.location.search);
      const notifAction = params.get("notif_action");
      const notifId = params.get("notif_id");
      if (notifAction && notifId) {
        routeNotificationAction(notifAction, notifId);
        params.delete("notif_action");
        params.delete("notif_id");
        const rest = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
      }
  
      const onServiceWorkerMessage = (event) => {
        if (event.data?.type === "notification-click") {
          routeNotificationAction(event.data.actionType, event.data.actionId);
        }
      };
      navigator.serviceWorker?.addEventListener?.("message", onServiceWorkerMessage);
  
      // Native equivalent of the sw.js "notification-click" relay above --
      // no-ops on web (see registerNativePushListeners's IS_NATIVE guard).
      const unregisterNativePush = registerNativePushListeners({
        onNotificationTapped: routeNotificationAction,
        notify,
      });
  
      return () => {
        navigator.serviceWorker?.removeEventListener?.("message", onServiceWorkerMessage);
        unregisterNativePush();
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-once by design, same as the popstate/SW-register effects
}

export { usePushDeepLinks };
