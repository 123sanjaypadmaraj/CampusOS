import { useEffect } from "react";
import { VENDOR_ALLOWED_KEYS } from "../config/routing";

function useRoleRedirect({ access, active, backendLoading, go, isFacilitiesAccount, isVendorAccount }) {
  useEffect(() => {
        if (backendLoading || access.loading) return;
  
        // Vendor accounts (owner or manager -- isVendorAccount covers both
        // 'vendor' and 'vendor_staff') are further restricted to their own
        // dashboard -- "home" isn't a safe fallback for them the way it is
        // for everyone else (their whole nav is the dashboard + profile), so
        // this branch bounces to "vendor" instead of falling through to the
        // shared check below, which would otherwise send them to a Home page
        // they don't have a nav button to get back out of.
        if (isVendorAccount) {
          if (!VENDOR_ALLOWED_KEYS.has(active)) go("vendor");
          return;
        }
  
        const roleGatedButAllowed =
          (active !== "admin" || access.isAdmin) &&
          (active !== "vendor" || isVendorAccount) &&
          (active !== "facilities" || isFacilitiesAccount || access.isAdmin);
        if (!roleGatedButAllowed) go("home");
      }, [active, backendLoading, access.loading, access.isAdmin, isVendorAccount, isFacilitiesAccount]); // eslint-disable-line react-hooks/exhaustive-deps
}

export { useRoleRedirect };
