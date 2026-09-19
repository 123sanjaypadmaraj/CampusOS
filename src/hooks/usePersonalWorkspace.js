import { useEffect } from "react";
import { getMyBookings, getMyOrders, getMyPendingPaymentEvents, getMyPrintJobs, getMyRegisteredEventIds, getMyServiceRequests, getSavedEvents, getSavedPosts, toggleSavedPost } from "../services/mvpService";

function usePersonalWorkspace({ authUser, notify, setBookings, setLoginOpen, setOrders, setPendingPaymentEvents, setPrintJobs, setRegisteredEventIds, setSavedEventIds, setSavedPostIds, setServiceRequests }) {
  const handleToggleSavePost = async (postId) => {
      if (!authUser?.id) {
        setLoginOpen(true);
        notify("Sign in to save posts");
        return;
      }
      try {
        const isSavedNow = await toggleSavedPost({ postId, userId: authUser.id });
        setSavedPostIds((current) =>
          isSavedNow ? [...current, postId] : current.filter((id) => id !== postId)
        );
      } catch (error) {
        notify(error.message || "Could not save this post");
      }
    };

  useEffect(() => {
        if (!authUser?.id) return;
        Promise.all([
          getMyRegisteredEventIds(authUser.id), getMyPendingPaymentEvents(authUser.id), getSavedEvents(authUser.id), getMyPrintJobs(authUser.id),
          getMyServiceRequests(authUser.id), getMyBookings(authUser.id), getMyOrders(authUser.id), getSavedPosts(authUser.id),
        ]).then(([registered, pendingPayment, saved, jobs, requests, myBookings, myOrders, savedPosts]) => {
          setRegisteredEventIds(registered); setPendingPaymentEvents(pendingPayment); setSavedEventIds(saved); setPrintJobs(jobs);
          setServiceRequests(requests); setBookings(myBookings); setOrders(myOrders); setSavedPostIds(savedPosts);
        }).catch((error) => console.error("Personal workspace loading failed", error));
      }, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- the setX are useState setters, stable

  return { handleToggleSavePost };
}

export { usePersonalWorkspace };
