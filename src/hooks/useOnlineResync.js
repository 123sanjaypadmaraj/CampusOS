import { useEffect, useRef } from "react";
import { getCampusEvents, getCampusFood, getOrCreateProfile, getSavedEvents, getUserNotifications } from "../services/mvpService";
import { useOnlineStatus } from "./useOnlineStatus";

function useOnlineResync({ authUser, campusId, setDbCanteens, setDbFoodItems, setEvents, setNotifications, setProfile, setSavedEventIds }) {
  const online = useOnlineStatus();

  const wasOnline = useRef(online);

  useEffect(() => {
        const justReconnected = !wasOnline.current && online;
        wasOnline.current = online;
        if (!justReconnected) return;
  
        if (campusId) {
          getCampusEvents(campusId).then(setEvents).catch(() => {});
          getCampusFood(campusId)
            .then(({ canteens, items }) => {
              setDbCanteens(canteens);
              setDbFoodItems(items);
            })
            .catch(() => {});
        }
  
        if (authUser?.id) {
          getOrCreateProfile(authUser, campusId).then(setProfile).catch(() => {});
          getSavedEvents(authUser.id).then(setSavedEventIds).catch(() => {});
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
          }).catch(() => {});
        }
      }, [online, campusId, authUser]); // eslint-disable-line react-hooks/exhaustive-deps -- the setX are useState setters, stable

  return { online };
}

export { useOnlineResync };
