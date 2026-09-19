import { useEffect } from "react";
import { getMyOrders, getUserNotifications, markAllNotificationsRead, subscribeToOrders, subscribeToUserNotifications } from "../services/mvpService";

function useNotifications({ authUser, notify, setNotifications, setOrders }) {
  const markNotificationsRead =
      async () => {
  
        setNotifications(
          (items) =>
            items.map(
              (item) => ({
                ...item,
                unread: false,
              })
            )
        );
  
        if (!authUser) {
          notify(
            "Notifications marked as read"
          );
  
          return;
        }
  
        try {
  
          await markAllNotificationsRead(
            authUser.id
          );
  
          notify(
            "All notifications marked as read"
          );
  
        } catch (error) {
  
          console.error(
            "Notification update:",
            error
          );
  
          notify(
            "Updated locally"
          );
        }
      };

  useEffect(() => {
        if (!authUser?.id) return;
  
        const unsubscribeNotifications = subscribeToUserNotifications(
          authUser.id,
          () => {
            getUserNotifications(authUser.id).then((items) => {
              if (items?.length) {
                setNotifications(
                  items.map((item) => ({
                    id: item.id,
                    type: item.type || "official",
                    title: item.title || "",
                    time: item.created_at
                      ? new Date(item.created_at).toLocaleString()
                      : "Recently",
                    unread: !item.read,
                    actionType: item.action_type || null,
                    actionId: item.action_id || null,
                  }))
                );
              }
            });
          }
        );
  
        const unsubscribeOrders = subscribeToOrders(authUser.id, () => {
          getMyOrders(authUser.id).then((ordersList) => {
            if (ordersList) {
              setOrders(ordersList);
            }
          });
        });
  
        return () => {
          unsubscribeNotifications?.();
          unsubscribeOrders?.();
        };
      }, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- the setX are useState setters, stable

  return { markNotificationsRead };
}

export { useNotifications };
