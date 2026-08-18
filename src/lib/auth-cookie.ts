/** Isolated demo identity. Never used as production proof of identity. */
export const DEMO_SESSION_COOKIE = "dc_demo_session";

/** Legacy cookie. Must be cleared, never trusted. */
export const LEGACY_SESSION_COOKIE = "dc_session";

/** @deprecated Use DEMO_SESSION_COOKIE. Kept so existing imports compile during the cutover. */
export const SESSION_COOKIE = DEMO_SESSION_COOKIE;
