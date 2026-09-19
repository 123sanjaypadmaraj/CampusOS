import React, { Suspense, lazy, useMemo, useRef, useState } from "react";
import campusOSLogoMark from "./assets/campusos-logo-mark.png";
import { ErrorState, InstallPromptBanner, LoadingState, OfflineBanner } from "./components/ui/States";
import { FEATURES } from "./config/features";
import { mobileNavItems, navItems, pathToKey } from "./config/routing";
import { YourActivity } from "./features/activity/YourActivity";
import { CampusAI } from "./features/ai/CampusAI";
import { LoginModal } from "./features/auth/LoginModal";
import { ResetPasswordPage } from "./features/auth/ResetPasswordPage";
import { SuspendedAccountScreen } from "./features/auth/SuspendedAccountScreen";
import { VerifyEmailPage } from "./features/auth/VerifyEmailPage";
import { CartModal } from "./features/cart/CartModal";
import { Clubs } from "./features/clubs/ClubsBrowse";
import { Events } from "./features/events/Events";
import { MyCalendar } from "./features/events/MyCalendar";
import { SOSModal } from "./features/facilities/SOSModal";
import { Food } from "./features/food/Food";
import { Campus } from "./features/home/Campus";
import { Home } from "./features/home/Home";
import { MobileHome } from "./features/home/MobileHome";
import { LegalPage } from "./features/legal/Legal";
import { NotificationsPage } from "./features/notifications/NotificationsPage";
import { PrintModal } from "./features/print/PrintModal";
import { EditProfileModal } from "./features/profile/EditProfileModal";
import { Profile } from "./features/profile/Profile";
import { GlobalSearchOverlay } from "./features/search/GlobalSearchOverlay";
import { ServiceDetail } from "./features/services/ServiceDetail";
import { Services } from "./features/services/ServicesHub";
import { People } from "./features/social/People";
import { PostComposer } from "./features/social/PostComposer";
import { Socialize } from "./features/social/Socialize";
import { Store } from "./features/store/StoreFront";
import { useInstallPrompt } from "./hooks/useInstallPrompt";
import { usePermissions } from "./hooks/usePermissions";
import { PLATFORM } from "./config/platform";
import { HiBell, HiCheckCircle, HiChatBubbleLeftRight, HiChevronRight, HiCog6Tooth, HiExclamationTriangle, HiMagnifyingGlass, HiMapPin, HiMoon, HiShoppingBag, HiSun, HiSwatch, HiUserCircle, HiWrenchScrewdriver } from "react-icons/hi2";
import { useServiceWorkerRegistration } from "./hooks/useServiceWorkerRegistration";
import { useNativeSplashScreen } from "./hooks/useNativeSplashScreen";
import { useToast } from "./hooks/useToast";
import { useTheme } from "./hooks/useTheme";
import { useIsMobile } from "./hooks/useIsMobile";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { useAndroidBackButton } from "./hooks/useAndroidBackButton";
import { useConversationNav } from "./hooks/useConversationNav";
import { usePushDeepLinks } from "./hooks/usePushDeepLinks";
import { useAuthSession } from "./hooks/useAuthSession";
import { useCampusFeed } from "./hooks/useCampusFeed";
import { useCampusDirectory } from "./hooks/useCampusDirectory";
import { useFoodAndStore } from "./hooks/useFoodAndStore";
import { useOpportunities } from "./hooks/useOpportunities";
import { useNotifications } from "./hooks/useNotifications";
import { useUnreadMessages } from "./hooks/useUnreadMessages";
import { usePersonalWorkspace } from "./hooks/usePersonalWorkspace";
import { useOnlineResync } from "./hooks/useOnlineResync";
import { useRoleRedirect } from "./hooks/useRoleRedirect";

const AdminCMS = lazy(() => import("./features/admin/AdminCMS"));

const VendorDashboard = lazy(() => import("./features/vendor/VendorDashboard"));

const FacilitiesDashboard = lazy(() => import("./features/facilities/FacilitiesDashboard"));

const Messages = lazy(() => import("./features/messages/Messages"));

const eventsSeed = [
  {
    id: "00000000-0000-4000-a000-000000000001",
    date: "12",
    month: "AUG",
    title: "Generative AI Workshop",
    club: "AI Club",
    time: "2:00 PM",
    place: "Seminar Hall 2",
    color: "purple",
    category: "Workshop",
    attendees: 184,
  },
  {
    id: "00000000-0000-4000-a000-000000000002",
    date: "14",
    month: "AUG",
    title: "Campus Hackathon 2026",
    club: "Coding Club",
    time: "9:00 AM",
    place: "Innovation Lab",
    color: "blue",
    category: "Hackathon",
    attendees: 420,
  },
  {
    id: "00000000-0000-4000-a000-000000000003",
    date: "16",
    month: "AUG",
    title: "Robotics Project Showcase",
    club: "Robotics Club",
    time: "4:30 PM",
    place: "Main Auditorium",
    color: "green",
    category: "Showcase",
    attendees: 142,
  },
];

const notificationsSeed = [
  {
    id: 1,
    type: "event",
    title: "AI Workshop starts in 30 minutes",
    time: "10 min ago",
    unread: true,
  },
  {
    id: 2,
    type: "service",
    title: "Print order #2048 is ready",
    time: "24 min ago",
    unread: true,
  },
  {
    id: 3,
    type: "community",
    title: "Someone replied to your post",
    time: "1 hr ago",
    unread: true,
  },
  {
    id: 4,
    type: "official",
    title: "Semester schedule has been published",
    time: "Yesterday",
    unread: false,
  },
];

const COLOR_THEMES = [
  { id: "violet", label: "Violet", swatchA: "#6945e8", swatchB: "#8b6cff" },
  { id: "ocean", label: "Ocean", swatchA: "#2f6fed", swatchB: "#6b93ff" },
  { id: "terracotta", label: "Terracotta", swatchA: "#c05a35", swatchB: "#e08a5c" },
  { id: "sage", label: "Sage", swatchA: "#4f7a52", swatchB: "#7ba57e" },
  { id: "rosewood", label: "Rosewood", swatchA: "#b5486e", swatchB: "#d97fa0" },
];

function App() {
  const { canInstall, promptInstall, dismiss: dismissInstallPrompt } = useInstallPrompt();

  const [active, setActive] = useState(() =>
      typeof window !== "undefined" ? pathToKey(window.location.pathname) : "home"
    );

  const [search, setSearch] = useState("");

  const [loginOpen, setLoginOpen] = useState(false);

  const [user, setUser] = useState(null);

  const [toast, setToast] = useState("");

  const [postFilter, setPostFilter] = useState("All");

  const [darkMode, setDarkMode] = useState(
      () => localStorage.getItem("campus-theme") === "dark"
    );

  const [colorTheme, setColorTheme] = useState(() => {
      const saved = localStorage.getItem("campus-color-theme");
      return COLOR_THEMES.some((t) => t.id === saved) ? saved : "violet";
    });

  const [themePickerOpen, setThemePickerOpen] = useState(false);

  const themePickerRef = useRef(null);

  const [notifications, setNotifications] = useState(notificationsSeed);

  const [modal, setModal] = useState(null);

  const [posts, setPosts] = useState([]);

  const [postsLoading, setPostsLoading] = useState(false);

  const [communityStats, setCommunityStats] = useState(null);

  const [foodCart, setFoodCart] = useState([]);

  const [storeCart, setStoreCart] = useState([]);

  const [printFile, setPrintFile] = useState(null);

  const [dbCanteens, setDbCanteens] = useState([]);

  const [dbFoodItems, setDbFoodItems] = useState([]);

  const [dbStoreItems, setDbStoreItems] = useState([]);

  const [dbStoresLoading, setDbStoresLoading] = useState(true);

  const [myStoreOrders, setMyStoreOrders] = useState([]);

  const [dbOpportunities, setDbOpportunities] = useState([]);

  const [dbMentors, setDbMentors] = useState([]);

  const [myApplicationIds, setMyApplicationIds] = useState([]);

  const [dbLoading, setDbLoading] = useState(true);

  const [dbError, setDbError] = useState("");

  const [authUser, setAuthUser] =
      useState(null);

  const [campusId, setCampusId] =
      useState(null);

  const [profile, setProfile] =
      useState(null);

  const access = usePermissions(profile?.id, profile?.role);

  const isVendorAccount = access.hasRole("vendor") || access.hasRole("vendor_staff");
  const isMobile = useIsMobile();
  const sumQuantity = (cart) => cart.reduce((total, entry) => total + (entry.quantity || 1), 0);
  const cartCount = sumQuantity(storeCart) + (FEATURES.food ? sumQuantity(foodCart) : 0);

  const isFacilitiesAccount = access.hasRole("facilities_staff");

  const [backendLoading, setBackendLoading] =
      useState(true);

  const [backendError, setBackendError] =
      useState("");

  const [orders, setOrders] =
      useState([]);

  const [people, setPeople] = useState([]);

  const [registeredEventIds, setRegisteredEventIds] = useState([]);

  const [pendingPaymentEvents, setPendingPaymentEvents] = useState([]);

  const [savedEventIds, setSavedEventIds] = useState([]);

  const [savedPostIds, setSavedPostIds] = useState([]);

  const [printJobs, setPrintJobs] = useState([]);

  const [serviceRequests, setServiceRequests] = useState([]);

  const [resources, setResources] = useState([]);

  const [bookings, setBookings] = useState([]);

  const [lostItems, setLostItems] = useState([]);

  const [lostItemsLoaded, setLostItemsLoaded] = useState(false);

  const [marketListings, setMarketListings] = useState([]);

  const [verification, setVerification] = useState(null);

  const [unreadMessageCount, setUnreadMessageCount] = useState(0);

  const [openConversationId, setOpenConversationId] = useState(null);

  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);

  const toastTimer = useRef(null);

  const filteredPosts = useMemo(() => {
      const q = search.toLowerCase().trim();
  
      return posts.filter(
        (p) =>
          (postFilter === "All" ||
            (postFilter === "Saved" ? savedPostIds.includes(p.id) : p.type === postFilter)) &&
          (!q ||
            `${p.title} ${p.author} ${p.tags.join(" ")}`
              .toLowerCase()
              .includes(q))
      );
    }, [search, postFilter, posts, savedPostIds]);

  const [events, setEvents] =
        useState([]);

  const [eventsLoading, setEventsLoading] =
        useState(false);

  const [clubs, setClubs] = useState([]);

  useServiceWorkerRegistration();
  useNativeSplashScreen();
  const { notify } = useToast({ setToast, toastTimer });
  const { selectColorTheme, toggleTheme } = useTheme({ darkMode, setColorTheme, setDarkMode, setThemePickerOpen, themePickerOpen, themePickerRef });
  const { go } = useAppNavigation({ active, setActive, setModal });
  useAndroidBackButton({ active });
  const { goToConversation } = useConversationNav({ go, setOpenConversationId });
  usePushDeepLinks({ go, goToConversation, notify });
  const { applyProfileUpdate, handleLogout, reloadVerification } = useAuthSession({ authUser, go, notify, profile, setAuthUser, setBackendError, setBackendLoading, setCampusId, setLoginOpen, setNotifications, setOrders, setProfile, setUser, setVerification });
  const { createPost } = useCampusFeed({ authUser, campusId, notify, setClubs, setCommunityStats, setEvents, setEventsLoading, setLoginOpen, setModal, setPosts, setPostsLoading });
  useCampusDirectory({ campusId, setLostItems, setLostItemsLoaded, setMarketListings, setPeople, setResources });
  const { addFood, addStore, checkoutFood, checkoutStore } = useFoodAndStore({ authUser, campusId, foodCart, notify, setDbCanteens, setDbError, setDbFoodItems, setDbLoading, setDbStoreItems, setDbStoresLoading, setFoodCart, setLoginOpen, setModal, setMyStoreOrders, setOrders, setStoreCart, storeCart, user });
  useOpportunities({ authUser, campusId, setDbMentors, setDbOpportunities, setMyApplicationIds });
  const { markNotificationsRead } = useNotifications({ authUser, notify, setNotifications, setOrders });
  useUnreadMessages({ authUser, setUnreadMessageCount });
  const { handleToggleSavePost } = usePersonalWorkspace({ authUser, notify, setBookings, setLoginOpen, setOrders, setPendingPaymentEvents, setPrintJobs, setRegisteredEventIds, setSavedEventIds, setSavedPostIds, setServiceRequests });
  const { online } = useOnlineResync({ authUser, campusId, setDbCanteens, setDbFoodItems, setEvents, setNotifications, setProfile, setSavedEventIds });
  useRoleRedirect({ access, active, backendLoading, go, isFacilitiesAccount, isVendorAccount });

  const renderPage = () => {
      if (active === "home") {
        if (isMobile) {
          return (
            <MobileHome
              go={go}
              authUser={authUser}
              profile={profile}
              events={events.length ? events : eventsSeed}
              openSearch={() => (authUser ? setGlobalSearchOpen(true) : setLoginOpen(true))}
              openSos={() => setModal("sos")}
              notify={notify}
            />
          );
        }

        return (
          <Home
            go={go}
            search={search}
            setSearch={setSearch}
            notify={notify}
            foodCart={foodCart}
            storeCart={storeCart}
            authUser={authUser}
          />
        );
      }
  
      if (active === "campus") {
        return (
          <Campus
            search={search}
            setSearch={setSearch}
            filter={postFilter}
            setFilter={setPostFilter}
            notify={notify}
            posts={filteredPosts}
            openModal={setModal}
            people={people}
            clubs={clubs}
            communityStats={communityStats}
            go={go}
            authUser={authUser}
            setLoginOpen={() => setLoginOpen(true)}
            postsLoading={postsLoading}
            savedPostIds={savedPostIds}
            onToggleSave={handleToggleSavePost}
          />
        );
      }
  
      if (active === "events") {
        return (
          <Events
            notify={notify}
            events={events.length ? events : eventsSeed}
            eventsLoading={eventsLoading}
            opportunities={dbOpportunities}
            mentors={dbMentors}
            appliedIds={myApplicationIds}
            onApplied={(id) => setMyApplicationIds((ids) => [...ids, id])}
            go={go}
            authUser={authUser}
            profile={profile}
            openLogin={() => setLoginOpen(true)}
            registeredIds={registeredEventIds}
            pendingPaymentEvents={pendingPaymentEvents}
            savedIds={savedEventIds}
            onRegistrationChange={setRegisteredEventIds}
            onPendingPaymentChange={setPendingPaymentEvents}
            onSavedChange={setSavedEventIds}
            onProfileUpdated={applyProfileUpdate}
          />
        );
      }
  
      if (active === "services") {
        return (
          <Services
            go={go}
            openModal={setModal}
            storeCart={storeCart}
            printFile={printFile}
          />
        );
      }
  
      if (active === "socialize") {
        return <Socialize notify={notify} people={people} profile={profile} campusId={campusId} authUser={authUser} openLogin={() => setLoginOpen(true)} onOpenConversation={goToConversation} />;
      }
  
      if (active === "messages") {
        if (!authUser) {
          return (
            <ErrorState
              title="Sign in to view messages"
              text="Messages are only available to signed-in students."
            />
          );
        }
        return (
          <Suspense fallback={<LoadingState label="Loading messages…" />}>
            <Messages
              notify={notify}
              authUser={authUser}
              profile={profile}
              people={people}
              openConversationId={openConversationId}
              onConversationOpened={() => setOpenConversationId(null)}
              onUnreadChange={setUnreadMessageCount}
            />
          </Suspense>
        );
      }
  
      if (active === "profile") {
        return (
          <Profile
            user={user}
            onLogin={() => setLoginOpen(true)}
            onLogout={handleLogout}
            notify={notify}
            openModal={setModal}
            profile={profile}
            onProfileUpdated={applyProfileUpdate}
            stats={{ posts: posts.length, events: registeredEventIds.length, clubs: 0 }}
            verification={verification}
            onVerificationChanged={reloadVerification}
            campusId={campusId}
            go={go}
          />
        );
      }
  
      if (active === "activity") {
        if (!authUser) {
          return (
            <ErrorState
              title="Sign in to view your activity"
              text="Your food orders, bookings, applications, payments and more all live here once you're signed in."
            />
          );
        }
        return (
          <YourActivity
            profile={profile}
            authUser={authUser}
            notify={notify}
            go={go}
            orders={orders}
            storeOrders={myStoreOrders}
            printJobs={printJobs}
            serviceRequests={serviceRequests}
            bookings={bookings}
            notifications={notifications}
          />
        );
      }
  
      if (active === "legal") {
        return <LegalPage go={go} />;
      }
  
      if (active === "verify-email") {
        return <VerifyEmailPage go={go} />;
      }
  
      if (active === "reset-password") {
        return <ResetPasswordPage go={go} notify={notify} />;
      }
  
      if (active === "people") {
        return (
          <People notify={notify} people={people} campusId={campusId} authUser={authUser} openLogin={() => setLoginOpen(true)} onOpenConversation={goToConversation} />
        );
      }
  
      if (active === "clubs") {
        return <Clubs notify={notify} clubs={clubs} authUser={authUser} setLoginOpen={setLoginOpen} campusId={campusId} />;
      }
  
      if (active === "food" && FEATURES.food) {
        return (
          <Food
          notify={notify}
          canteens={dbCanteens}
          items={dbFoodItems}
          cart={foodCart}
          addFood={addFood}
          openModal={setModal}
          loading={dbLoading}
          error={dbError}
        />
        );
      }
  
      if (active === "store") {
        return (
          <Store
            notify={notify}
            items={dbStoreItems}
            loading={dbStoresLoading}
            cart={storeCart}
            addStore={addStore}
            openModal={setModal}
            orders={myStoreOrders}
          />
        );
      }
  
      if (active === "ai") {
        return <CampusAI notify={notify} go={go} authUser={authUser} profile={profile} campusId={campusId} addFood={addFood} openLogin={() => setLoginOpen(true)} />;
      }
  
      if (active === "admin") {
        if (!access.isAdmin) {
          return (
            <ErrorState
              title="Admin access only"
              text="This area is restricted to campus administrators."
            />
          );
        }
        return (
          <Suspense fallback={<LoadingState label="Loading admin console…" />}>
            <AdminCMS notify={notify} campusId={campusId} authUser={authUser} can={access.can} />
          </Suspense>
        );
      }
  
      if (active === "vendor") {
        if (!isVendorAccount) {
          return (
            <ErrorState
              title="Vendor access only"
              text="This area is restricted to vendor accounts."
            />
          );
        }
        return (
          <Suspense fallback={<LoadingState label="Loading vendor dashboard…" />}>
            <VendorDashboard notify={notify} authUser={authUser} />
          </Suspense>
        );
      }
  
      if (active === "facilities") {
        if (!isFacilitiesAccount && !access.isAdmin) {
          return (
            <ErrorState
              title="Facilities staff access only"
              text="This area is restricted to facilities staff accounts."
            />
          );
        }
        return (
          <Suspense fallback={<LoadingState label="Loading facilities dashboard…" />}>
            <FacilitiesDashboard notify={notify} campusId={campusId} />
          </Suspense>
        );
      }
  
      if (active === "calendar") {
        return <MyCalendar notify={notify} events={events.length ? events : eventsSeed} />;
      }
  
      if (active === "notifications") {
        return (
          <NotificationsPage
            notifications={notifications}
            markRead={markNotificationsRead}
            notify={notify}
            onOpenConversation={goToConversation}
            authUser={authUser}
            profile={profile}
          />
        );
      }
  
      if (
        [
          "print",
          "issues",
          "booking",
          "lost",
          "market",
          "academics",
          "emergencydirectory",
          "support",
        ].includes(active)
      ) {
        return (
          <ServiceDetail
            serviceId={active}
            notify={notify}
            go={go}
            openModal={setModal}
            openLogin={() => setLoginOpen(true)}
            authUser={authUser}
            profile={profile}
            campusId={campusId}
            resources={resources}
            bookings={bookings}
            serviceRequests={serviceRequests}
            printJobs={printJobs}
            lostItems={lostItems}
            lostItemsLoaded={lostItemsLoaded}
            marketListings={marketListings}
            onBookingsChange={setBookings}
            onRequestsChange={setServiceRequests}
            onLostItemsChange={setLostItems}
            onMarketListingsChange={setMarketListings}
            onPrintJobsChange={setPrintJobs}
            onOpenConversation={goToConversation}
            can={access.can}
            isAdmin={access.isAdmin}
          />
        );
      }
  
      return <Home go={go} search={search} setSearch={setSearch} notify={notify} foodCart={foodCart} storeCart={storeCart} authUser={authUser} />;
    };

  return (
      <div className={`app-shell ${darkMode ? "dark-mode" : "light-mode"} theme-${colorTheme} platform-${PLATFORM}${isMobile ? " is-mobile" : ""}${isMobile && cartCount > 0 && !isVendorAccount ? " has-cart" : ""}`}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <header className="topbar">
          <button
            className="brand"
            onClick={() => go(isVendorAccount ? "vendor" : "home")}
            aria-label="Campus OS home"
          >
            <span className="brand-mark">
              <img src={campusOSLogoMark} alt="" />
            </span>
            <span>
              <b>Campus</b>
              <em>OS</em>
            </span>
          </button>
  
          <div className="location">
            <span className="pin">
              <HiMapPin />
            </span>
            <span>
              <small>YOUR CAMPUS</small>
              <b>New Horizon College Of Engineering</b>
            </span>
          </div>
  
          <div className="top-actions">
            {authUser && !isVendorAccount && (
              <button
                className="icon-btn"
                onClick={() => setGlobalSearchOpen(true)}
                aria-label="Search CampusOS"
                data-testid="global-search-button"
              >
                <HiMagnifyingGlass />
              </button>
            )}
  
            {isMobile && authUser && !isVendorAccount && (
              <button
                className="icon-btn"
                onClick={() => go("messages")}
                aria-label={unreadMessageCount > 0 ? `Messages, ${unreadMessageCount} unread` : "Messages"}
                data-testid="topbar-messages-button"
              >
                <HiChatBubbleLeftRight />
                {unreadMessageCount > 0 && <i>{unreadMessageCount > 9 ? "9+" : unreadMessageCount}</i>}
              </button>
            )}

            <button
              className="icon-btn"
              onClick={() => {
                go("notifications");
                markNotificationsRead();
              }}
              aria-label="Notifications"
            >
              <HiBell />
              <i>{notifications.filter((n) => n.unread).length}</i>
            </button>
  
            <div className="theme-picker" ref={themePickerRef}>
              <button
                className="icon-btn"
                onClick={() => setThemePickerOpen((open) => !open)}
                aria-label="Theme settings"
                aria-haspopup="true"
                aria-expanded={themePickerOpen}
              >
                <HiSwatch />
              </button>
              {themePickerOpen && (
                <div className="theme-picker-panel" role="menu">
                  <span className="theme-picker-label">Color theme</span>
                  <div className="theme-swatch-row">
                    {COLOR_THEMES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={colorTheme === t.id}
                        className={`theme-swatch${colorTheme === t.id ? " active" : ""}`}
                        style={{ "--swatch-a": t.swatchA, "--swatch-b": t.swatchB }}
                        onClick={() => selectColorTheme(t.id)}
                        title={t.label}
                      >
                        <span className="sr-only">{t.label}</span>
                      </button>
                    ))}
                  </div>
  
                  <span className="theme-picker-label theme-picker-label-appearance">
                    Appearance
                  </span>
                  <button
                    type="button"
                    className="theme-toggle"
                    onClick={toggleTheme}
                    aria-label={
                      darkMode ? "Switch to light mode" : "Switch to dark mode"
                    }
                  >
                    <span className="theme-track">
                      <span className="theme-thumb">
                        {darkMode ? <HiMoon /> : <HiSun />}
                      </span>
                    </span>
                    <span className="theme-toggle-label">
                      {darkMode ? "Dark" : "Light"}
                    </span>
                  </button>
                </div>
              )}
            </div>
  
            {user ? (
              <button className="profile-mini" onClick={() => go("profile")}>
                <span>{user.name[0]}</span>
                {user.name.split(" ")[0]}
              </button>
            ) : (
              <button
                className="login-btn"
                onClick={() => setLoginOpen(true)}
                data-testid="sign-in-button"
              >
                Sign in
              </button>
            )}
          </div>
        </header>
  
        <OfflineBanner online={online} />
        <InstallPromptBanner canInstall={canInstall} onInstall={promptInstall} onDismiss={dismissInstallPrompt} />
  
        {backendError && (
          <div className="offline-banner offline-banner--error" role="alert">
            <HiExclamationTriangle /> {backendError} — some data may be out of date.
          </div>
        )}
  
        <main id="main-content" tabIndex={-1}>{profile?.status === "suspended" ? <SuspendedAccountScreen profile={profile} notify={notify} /> : renderPage()}</main>
  
        {isMobile && !isVendorAccount && cartCount > 0 && (
          <button
            type="button"
            className="mobile-cart-bar"
            onClick={() => setModal(FEATURES.food && foodCart.length > 0 ? "food-cart" : "store-cart")}
            data-testid="mobile-cart-bar"
          >
            <span className="mobile-cart-bar-icon"><HiShoppingBag /></span>
            <span className="mobile-cart-bar-copy">
              <b>{cartCount} {cartCount === 1 ? "item" : "items"} in cart</b>
              <small>Tap to review</small>
            </span>
            <span className="mobile-cart-bar-cta">View cart <HiChevronRight /></span>
          </button>
        )}

        <nav className="bottom-nav" aria-label="Primary">
          {/* A vendor account is a purpose-built ordering console, not the
              full student nav plus an extra tab -- swap the whole bar for
              just Dashboard + Profile rather than filtering navItems down to
              one real entry and bolting a second button on after it. */}
          {(isVendorAccount ? [["vendor", <HiShoppingBag key="vendor-icon" />, "Dashboard"], ["profile", <HiUserCircle key="profile-icon" />, "Profile"]] : isMobile ? mobileNavItems : navItems).map(([key, icon, label]) => (
            <button
              key={key}
              className={active === key ? "active" : ""}
              onClick={() => go(key)}
              aria-current={active === key ? "page" : undefined}
              data-testid={`nav-${key}-button`}
            >
              <span style={key === "messages" ? { position: "relative" } : undefined}>
                {icon}
                {key === "messages" && unreadMessageCount > 0 && (
                  <i style={{ position: "absolute", top: -6, right: -10, width: 16, height: 16, borderRadius: "50%", fontSize: 9, background: "var(--purple)", color: "#fff", fontStyle: "normal", display: "grid", placeItems: "center" }}>
                    {unreadMessageCount > 9 ? "9+" : unreadMessageCount}
                  </i>
                )}
              </span>
              <small>{label}</small>
            </button>
          ))}
          {access.isAdmin && (
            <button
              className={active === "admin" ? "active" : ""}
              onClick={() => go("admin")}
              aria-current={active === "admin" ? "page" : undefined}
              data-testid="nav-admin-button"
            >
              <span><HiCog6Tooth /></span>
              <small>Admin</small>
            </button>
          )}
          {isFacilitiesAccount && (
            <button
              className={active === "facilities" ? "active" : ""}
              onClick={() => go("facilities")}
              aria-current={active === "facilities" ? "page" : undefined}
              data-testid="nav-facilities-button"
            >
              <span><HiWrenchScrewdriver /></span>
              <small>Tickets</small>
            </button>
          )}
        </nav>
  
        {loginOpen && (
          <LoginModal
            onClose={() => setLoginOpen(false)}
            notify={notify}
          />
        )}
  
        {globalSearchOpen && (
          <GlobalSearchOverlay
            onClose={() => setGlobalSearchOpen(false)}
            go={go}
            setSearch={setSearch}
            authUser={authUser}
            openLogin={() => setLoginOpen(true)}
            notify={notify}
          />
        )}
  
        {modal === "post" && (
          <PostComposer
            onClose={() => setModal(null)}
            onCreate={createPost}
            user={user}
            authUser={authUser}
            notify={notify}
          />
        )}
  
        {modal === "edit-profile" && profile && (
          <EditProfileModal
            profile={profile}
            onClose={() => setModal(null)}
            onSaved={(next) => { applyProfileUpdate(next); setModal(null); notify("Profile updated"); }}
            notify={notify}
          />
        )}
  
        {modal === "food-cart" && FEATURES.food && (
        <CartModal
          title="Food cart"
          cart={foodCart}
          type="food"
          onClose={() => setModal(null)}
          notify={notify}
          onCheckout={checkoutFood}
          onUpdateQuantity={(index, quantity) =>
            setFoodCart((cart) => (quantity <= 0 ? cart.filter((_, i) => i !== index) : cart.map((entry, i) => (i === index ? { ...entry, quantity } : entry))))
          }
          onRemove={(index) => setFoodCart((cart) => cart.filter((_, i) => i !== index))}
        />
        )}
  
        {modal === "store-cart" && (
          <CartModal
            title="Store cart"
            cart={storeCart}
            type="store"
            onClose={() => setModal(null)}
            notify={notify}
            onCheckout={checkoutStore}
            onUpdateQuantity={(index, quantity) =>
              setStoreCart((cart) => (quantity <= 0 ? cart.filter((_, i) => i !== index) : cart.map((entry, i) => (i === index ? { ...entry, quantity } : entry))))
            }
            onRemove={(index) => setStoreCart((cart) => cart.filter((_, i) => i !== index))}
          />
        )}
  
        {modal === "print" && (
          <PrintModal
            onClose={() => setModal(null)}
            setPrintFile={setPrintFile}
            notify={notify}
            authUser={authUser}
            user={user}
            campusId={campusId}
          />
        )}
  
        {modal === "sos" && (
          <SOSModal
            onClose={() => setModal(null)}
            notify={notify}
            authUser={authUser}
            openLogin={() => setLoginOpen(true)}
          />
        )}
  
        {toast && (
          <div className="toast" role="status" aria-live="polite">
            <HiCheckCircle />
            {toast}
          </div>
        )}
      </div>
    );
}

export default App;
