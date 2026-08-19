// Data layer for the Campus Emergency Directory (doc §113 second half --
// supabase/migrations/20260817000100_emergency_directory.sql). The backend
// shipped 2026-08-17 fully live-verified with no frontend; this re-exports
// the mvpService.js wrappers, same pattern as features/facilities/api.js.

export {
  listEmergencyDirectory,
  adminListEmergencyDirectory,
  upsertEmergencyDirectoryEntry,
  verifyEmergencyDirectoryEntry,
  setEmergencyDirectoryActive,
} from "../../services/mvpService";
