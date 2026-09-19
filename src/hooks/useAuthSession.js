import { useEffect } from "react";
import { deriveGithubUrlFromIdentities, getCurrentUser, getDefaultCampus, getMyOrders, getMyVerification, getOrCreateProfile, getUserNotifications, hasLinkedinIdentity, markLinkedinVerified, signOut, subscribeToAuthChanges, touchActivity, updateProfile } from "../services/mvpService";

function useAuthSession({ authUser, go, notify, profile, setAuthUser, setBackendError, setBackendLoading, setCampusId, setLoginOpen, setNotifications, setOrders, setProfile, setUser, setVerification }) {
  const applyProfileUpdate = (next) => {
      setProfile(next);
      setUser((current) => ({ ...current, ...next }));
    };

  const handleLogout = async () => {
    try {
      await signOut();
  
      setAuthUser(null);
      setProfile(null);
      setUser(null);
  
      go("home");
  
      notify(
        "You have been logged out"
      );
  
    } catch (error) {
      console.error(
        "Logout failed:",
        error
      );
  
      notify(
        "Logout failed"
      );
    }
  };

  useEffect(() => {
        let mounted = true;
  
        async function initialize() {
          try {
            setBackendLoading(true);
            setBackendError("");
  
            const campus = await getDefaultCampus();
            if (!mounted) return;
  
            setCampusId(campus.id);
  
            const currentUser = await getCurrentUser();
  
            if (currentUser) {
              const currentProfile = await getOrCreateProfile(
                currentUser,
                campus.id
              );
  
              if (!mounted) return;
  
              setAuthUser(currentUser);
              setProfile(currentProfile);
              // Fire-and-forget DAU ping (see mvpService.js) -- wrapped so a
              // failure here (e.g. an incomplete mock in tests) can never
              // abort the rest of this init flow.
              try { touchActivity(); } catch (pingError) { console.warn("touchActivity warning:", pingError); }
  
              setUser({
                name:
                  currentProfile?.name ||
                  currentUser.email?.split("@")[0] ||
                  "Campus Student",
                email: currentUser.email || "",
                usn: currentProfile?.usn || "",
                course:
                  currentProfile?.course ||
                  "Computer Science & Engineering",
                year: currentProfile?.year || "2nd Year",
              });
  
              const [userNotifications, userOrders] = await Promise.all([
                getUserNotifications(currentUser.id),
                getMyOrders(currentUser.id),
              ]);
  
              if (!mounted) return;
  
              if (userNotifications?.length) {
                setNotifications(
                  userNotifications.map((item) => ({
                    id: item.id,
                    type: item.type || "official",
                    title: item.title || "",
                    time: item.created_at
                      ? new Date(item.created_at).toLocaleString()
                      : "Recently",
                    unread: !item.read,
                  }))
                );
              }
              if (userOrders?.length) {
                setOrders(userOrders);
              }
            }
          } catch (error) {
            console.error("CampusOS initialization failed:", error);
            if (mounted) {
              setBackendError(
                error?.message || "Unable to connect to CampusOS."
              );
            }
          } finally {
            if (mounted) {
              setBackendLoading(false);
            }
          }
        }
  
        initialize();
  
        const unsubscribe = subscribeToAuthChanges(async ({ user: nextUser }) => {
          if (!mounted) return;
          setAuthUser(nextUser);
          if (!nextUser) {
            setProfile(null);
            setUser(null);
            return;
          }
          try {
            const campus = await getDefaultCampus();
            const currentProfile = await getOrCreateProfile(
              nextUser,
              campus.id
            );
            if (!mounted) return;
            setCampusId(campus.id);
            setProfile(currentProfile);
            setUser({
              name:
                currentProfile?.name ||
                nextUser.email?.split("@")[0] ||
                "Campus Student",
              email: nextUser.email || "",
              usn: currentProfile?.usn || "",
              course:
                currentProfile?.course ||
                "Computer Science & Engineering",
              year: currentProfile?.year || "2nd Year",
            });
            setLoginOpen(false);
            notify("Welcome to CampusOS");
          } catch (error) {
            console.error("Auth sync failed:", error);
          }
        });
  
        return () => {
          mounted = false;
          unsubscribe?.();
        };
      }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-once by design; notify/setX are stable across renders

  const reloadVerification = () => {
        if (!profile?.id) { setVerification(null); return; }
        getMyVerification(profile.id).then(setVerification).catch((error) => console.error("Verification status loading failed", error));
      };

  useEffect(() => { reloadVerification(); }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
        if (!authUser?.identities || !profile?.id) return;
        const derived = deriveGithubUrlFromIdentities(authUser.identities);
        if (derived && derived !== profile.github_url) {
          updateProfile(profile.id, { github_url: derived })
            .then(applyProfileUpdate)
            .catch((error) => console.error("GitHub link sync failed", error));
        }
      }, [authUser?.identities, profile?.id, profile?.github_url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
        if (!authUser?.identities || !profile?.id || profile.linkedin_verified_at) return;
        if (!hasLinkedinIdentity(authUser.identities)) return;
        markLinkedinVerified()
          .then(applyProfileUpdate)
          .catch((error) => console.error("LinkedIn verification sync failed", error));
      }, [authUser?.identities, profile?.id, profile?.linkedin_verified_at]); // eslint-disable-line react-hooks/exhaustive-deps

  return { applyProfileUpdate, handleLogout, reloadVerification };
}

export { useAuthSession };
