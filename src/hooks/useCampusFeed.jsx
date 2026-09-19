import { useEffect } from "react";
import { getCampusEvents, getCampusPosts, getClubs, getCommunityStats, publishPost, subscribeToClubs, subscribeToEvents, subscribeToPosts } from "../services/mvpService";
import { HiMegaphone } from "react-icons/hi2";

function useCampusFeed({ authUser, campusId, notify, setClubs, setCommunityStats, setEvents, setEventsLoading, setLoginOpen, setModal, setPosts, setPostsLoading }) {
  const createPost = async (post) => {
      try {
  
        if (!authUser) {
          setLoginOpen(true);
  
          notify(
            "Sign in to publish posts"
          );
  
          return;
        }
  
        const savedPost =
          await publishPost({
            userId:
              authUser.id,
  
            campusId,
  
            type:
              post.type,
  
            title:
              post.title,
  
            content:
              post.content || "",
  
            tags:
              post.tags || [],
  
            imageUrls:
              post.images || [],
          });
  
        setPosts(
          (current) => [
            {
              ...post,
  
              id:
                savedPost.id,
  
              icon:
                <HiMegaphone />,
  
              time:
                "Just now",
  
              likes: 0,
  
              comments: 0,
  
              images:
                post.images || [],
  
              verified: true,
            },
  
            ...current,
          ]
        );
  
        setModal(null);
  
        notify(
          "Post published to Campus Feed"
        );
  
      } catch (error) {
  
        console.error(
          "Post creation:",
          error
        );
  
        notify(
          error.message ||
          "Unable to publish post"
        );
      }
    };

  useEffect(() => {
          if (!campusId) return;
  
          let mounted = true;
  
          async function loadClubs() {
            try {
              const data =
                await getClubs(
                  campusId
                );
  
              if (mounted) {
                setClubs(data);
              }
  
            } catch (error) {
              console.error(
                "Club loading failed:",
                error
              );
            }
          }
  
          loadClubs();
          const unsub = subscribeToClubs(() => loadClubs());
  
          return () => {
            mounted = false;
            unsub?.();
          };
        }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps -- the setX are useState setters, stable

  useEffect(() => {
          if (!campusId) return;
  
          let mounted = true;
  
          async function loadPosts() {
            try {
              setPostsLoading(true);
              const data = await getCampusPosts(campusId);
              if (mounted) setPosts(data);
            } catch (error) {
              console.error("Post loading failed:", error);
            } finally {
              if (mounted) setPostsLoading(false);
            }
          }
  
          loadPosts();
          const unsub = subscribeToPosts(() => loadPosts());
  
          return () => {
            mounted = false;
            unsub?.();
          };
        }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps -- the setX are useState setters, stable

  useEffect(() => {
          if (!campusId) return;
  
          let mounted = true;
  
          getCommunityStats(campusId)
            .then((stats) => {
              if (mounted) setCommunityStats(stats);
            })
            .catch((error) => console.error("Community stats loading failed:", error));
  
          return () => {
            mounted = false;
          };
        }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps -- the setX are useState setters, stable

  useEffect(() => {
          if (!campusId) return;
  
          let mounted = true;
  
          async function loadEvents() {
            try {
              setEventsLoading(true);
              const data = await getCampusEvents(campusId);
              if (mounted) setEvents(data);
            } catch (error) {
              console.error("Event loading failed:", error);
            } finally {
              if (mounted) setEventsLoading(false);
            }
          }
  
          loadEvents();
          const unsub = subscribeToEvents(() => loadEvents());
  
          return () => {
            mounted = false;
            unsub?.();
          };
        }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps -- the setX are useState setters, stable

  return { createPost };
}

export { useCampusFeed };
