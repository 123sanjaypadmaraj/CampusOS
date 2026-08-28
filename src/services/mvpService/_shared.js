/**
 * Internal helpers shared across the mvpService/* domain modules.
 *
 * Not part of the public data-layer API (nothing here is re-exported from
 * ../mvpService.js) -- these are implementation details every domain module
 * imports directly, kept in one place so behavior like error-shape parsing
 * stays identical everywhere it's used.
 */

/** Short, human-typeable code generator (e.g. for print job pickup codes).
 * Excludes visually-ambiguous characters (0/O, 1/I, etc. are already absent
 * from the alphabet below) so a code read off a screen is easy to key in. */
export function randomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";

  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }

  return result;
}

/** Formats a timestamp as "3m ago" / "2d ago" style relative text, falling
 * back to a locale date string once it's a week or older. */
export function formatRelativeTime(date) {
  if (!date) return "";

  const diff = Math.max(
    0,
    Date.now() - new Date(date).getTime()
  );

  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d ago`;
  }

  return new Date(date).toLocaleDateString();
}

// Client-side compression before upload -- same technique as
// features/vendor/api.js's compressImage (longest edge to 1280px, JPEG
// q0.8), kept as a separate copy here rather than imported from there since
// mvpService is a shared/core service and vendor/api.js is a feature module
// -- importing the other way round would be the wrong dependency direction.
// Used by both posts.js (post images) and support.js (ticket screenshot
// attachments), which is why it lives here rather than in either of them.
export async function compressImage(file, maxDim = 1280, quality = 0.8) {
  if (typeof document === "undefined" || !file.type?.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
  } catch {
    return file; // best-effort -- never block an upload on a compression failure
  }
}

// Postgres RPC errors raised as `raise exception 'CODE: message'` (doc §81)
// arrive here as error.message === "CODE: message". Split that into a
// machine-readable `.code` and a clean, user-facing `.message` so every
// catch block in the UI shows readable text instead of a shouty prefix.
export function throwIfError(error) {
  if (!error) return;

  const match = /^([A-Z][A-Z0-9_]{2,}):\s*(.+)$/.exec(error.message || "");
  if (match) {
    const wrapped = new Error(match[2]);
    wrapped.code = match[1];
    wrapped.cause = error;
    throw wrapped;
  }

  throw error;
}
