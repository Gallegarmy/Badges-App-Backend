import { getAccessForUser, getEventBySlug } from "./service.js";
import { findStandByEventAndCode, findUserByEmailQuery } from "./repository.js";

export const STAND_CODE_REGEX = /^[a-z0-9-]{2,40}$/;

export const getRoleFromAccess = (access) =>
  access.is_admin ? "conference_admin" : access.is_stand_staff ? "stand_staff" : "attendee";

export const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
export const normalizeStandCode = (value) => String(value || "").trim().toLowerCase();

export async function getEventOrRespond(
  res,
  eventSlug,
  options = {},
  notFoundMessage = "Event not found"
) {
  const event = await getEventBySlug(eventSlug, options);
  if (!event) {
    res.status(404).json({ error: notFoundMessage });
    return null;
  }
  return event;
}

export async function ensureAdminAccessOrRespond(res, eventId, userId) {
  const access = await getAccessForUser(eventId, userId);
  if (!access.is_admin) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return access;
}

export async function findStandForEvent(eventId, standCode, selectFields = "id, code, name") {
  return findStandByEventAndCode(eventId, standCode, selectFields);
}

export async function findUserByEmail(email, selectFields = "id, email, username, created_at") {
  return findUserByEmailQuery(normalizeEmail(email), selectFields);
}
