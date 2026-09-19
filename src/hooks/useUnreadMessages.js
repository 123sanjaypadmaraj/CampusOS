import { useEffect } from "react";
import { getUnreadMessageCount, subscribeToConversationList } from "../services/messagingService";

function useUnreadMessages({ authUser, setUnreadMessageCount }) {
  const reloadUnreadMessages = () => {
        if (!authUser?.id) { setUnreadMessageCount(0); return; }
        getUnreadMessageCount().then(setUnreadMessageCount).catch(() => {});
      };

  useEffect(() => {
        reloadUnreadMessages();
        if (!authUser?.id) return;
  
        const unsubMessages = subscribeToConversationList(() => reloadUnreadMessages());
        return () => unsubMessages?.();
      }, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}

export { useUnreadMessages };
