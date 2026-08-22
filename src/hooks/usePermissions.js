import { useCallback, useEffect, useRef, useState } from "react";

import { getMyAccess } from "../services/mvpService";

const EMPTY = { permissions: new Set(), roles: new Set(), isAdmin: false, loading: false };

/** RBAC frontend permission layer (readiness-audit phase 2): the single
 * source of truth every screen should use instead of comparing
 * `profile.role` against a hardcoded string. Backed by get_my_access()
 * (20260822000100_rbac_frontend_permission_layer.sql), which reads the same
 * role_permissions/user_roles tables every RLS policy and RPC already
 * enforces against -- a permission or role this hook says "no" to is one the
 * backend would reject too, not a guess.
 *
 * Re-fetches whenever the signed-in user or their profile.role changes (role
 * changes only ever target *other* accounts in this app today, but this
 * keeps the hook correct if that ever changes, and it's what re-runs it on
 * sign-in/sign-out). Fails closed: a network error or a signed-out user both
 * resolve to "no permissions" rather than throwing, since a permission gate
 * hiding UI is always safer than one that crashes it. */
export function usePermissions(userId, role) {
  const [state, setState] = useState({ ...EMPTY, loading: !!userId });
  const requestId = useRef(0);

  useEffect(() => {
    const thisRequest = ++requestId.current;

    if (!userId) {
      setState({ ...EMPTY, loading: false });
      return;
    }

    setState((current) => ({ ...current, loading: true }));

    getMyAccess()
      .then((access) => {
        if (requestId.current !== thisRequest) return; // superseded by a newer call
        setState({
          permissions: new Set(access.permissions || []),
          roles: new Set(access.roles || []),
          isAdmin: !!access.is_admin,
          loading: false,
        });
      })
      .catch((error) => {
        console.error("usePermissions fetch failed:", error);
        if (requestId.current !== thisRequest) return;
        setState({ ...EMPTY, loading: false });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, role]);

  const can = useCallback((permissionKey) => state.permissions.has(permissionKey), [state.permissions]);
  const hasRole = useCallback((roleKey) => state.roles.has(roleKey), [state.roles]);

  return {
    loading: state.loading,
    isAdmin: state.isAdmin,
    permissions: state.permissions,
    roles: state.roles,
    can,
    hasRole,
  };
}
