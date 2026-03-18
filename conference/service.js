import jwt from "jsonwebtoken";
import { pool } from "../db.js";

// QR configuration for stand claim flow.
export const STAND_QR_TTL_SECONDS = Number(process.env.STAND_QR_TTL_SECONDS || 300);
export const STAND_QR_IS_PERSISTENT =
  !Number.isFinite(STAND_QR_TTL_SECONDS) || STAND_QR_TTL_SECONDS <= 0;
const FAR_FUTURE_EXPIRY = "9999-12-31T23:59:59.000Z";

const EVENT_SELECT_FIELDS =
  "id, name, slug, description, starts_at, ends_at, is_active, zero_weight_full_completion_single_entry";

function getEventWhereClause({ onlyActive = false } = {}) {
  return onlyActive
    ? "WHERE slug = $1 AND is_active = true AND starts_at <= now() AND ends_at >= now()"
    : "WHERE slug = $1";
}

export function getStandQrExpiryDate() {
  if (STAND_QR_IS_PERSISTENT) {
    return new Date(FAR_FUTURE_EXPIRY);
  }
  return new Date(Date.now() + STAND_QR_TTL_SECONDS * 1000);
}

export function toSafeCode(input) {
  const base = String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "badge";
}

export function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function toNonNegativeNumber(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

export function shouldUseZeroWeightFullCompletionRule(event, stands) {
  if (!event?.zero_weight_full_completion_single_entry) {
    return false;
  }

  if (!Array.isArray(stands) || stands.length === 0) {
    return false;
  }

  const requiredStands = stands.filter((stand) => stand.is_required);
  if (!requiredStands.length) {
    return false;
  }

  const allRequiredZeroWeight = requiredStands.every(
    (stand) => toNonNegativeNumber(stand.entries_weight) === 0
  );
  const allStandsZeroWeight = stands.every(
    (stand) => toNonNegativeNumber(stand.entries_weight) === 0
  );

  return allRequiredZeroWeight && allStandsZeroWeight;
}

export function getOptionalAuthUser(req) {
  const header = req.headers.authorization;
  if (!header) return null;

  if (!header.startsWith("Bearer ")) {
    throw Object.assign(new Error("Invalid token"), { status: 401 });
  }

  const token = header.split(" ")[1];
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw Object.assign(new Error("Invalid token"), { status: 401 });
  }
}

export async function getEventBySlug(eventSlug, { onlyActive = false } = {}) {
  const whereClause = getEventWhereClause({ onlyActive });

  const { rows } = await pool.query(
    `SELECT ${EVENT_SELECT_FIELDS} FROM events ${whereClause}`,
    [eventSlug]
  );

  return rows[0] || null;
}

export async function getAccessForUser(eventId, userId) {
  const { rows } = await pool.query(
    `
    SELECT cm.role, cm.stand_id, s.code AS stand_code, s.name AS stand_name
    FROM conference_memberships cm
    LEFT JOIN stands s ON s.id = cm.stand_id
    WHERE cm.event_id = $1 AND cm.user_id = $2
    `,
    [eventId, userId]
  );

  const isAdmin = rows.some((row) => row.role === "conference_admin");
  const stands = rows
    .filter((row) => row.role === "stand_staff" && row.stand_id)
    .map((row) => ({
      stand_id: row.stand_id,
      stand_code: row.stand_code,
      stand_name: row.stand_name,
    }));

  return {
    is_admin: isAdmin,
    is_stand_staff: stands.length > 0,
    stands,
  };
}

export function getDestinationForAccess(access) {
  if (access.is_admin) return "admin";
  if (access.is_stand_staff) return "stand";
  return "progress";
}

async function shouldUseZeroWeightRuleForEvent(eventId) {
  const [eventRes, standsRes] = await Promise.all([
    pool.query(
      "SELECT id, zero_weight_full_completion_single_entry FROM events WHERE id = $1 LIMIT 1",
      [eventId]
    ),
    pool.query(
      `
      SELECT is_required, entries_weight
      FROM stands
      WHERE event_id = $1
      `,
      [eventId]
    ),
  ]);

  return shouldUseZeroWeightFullCompletionRule(eventRes.rows[0] || null, standsRes.rows);
}

function getRaffleEntriesCaseSql() {
  return `
    CASE
      WHEN $2::boolean = true THEN
        CASE
          WHEN st.total > 0 AND pu.stands_visited = st.total THEN 1
          ELSE 0
        END
      WHEN pu.required_visited = et.total THEN 1 + pu.optional_entries
      ELSE 0
    END
  `;
}

function getEntriesQuery(raffleEntriesCaseSql) {
  return `
    WITH event_totals AS (
      SELECT COUNT(*)::int AS total
      FROM stands
      WHERE event_id = $1 AND is_required = true
    ),
    stands_total AS (
      SELECT COUNT(*)::int AS total
      FROM stands
      WHERE event_id = $1
    ),
    per_user AS (
      SELECT
        u.id AS user_id,
        u.email,
        u.username,
        COUNT(*) FILTER (WHERE s.is_required = true) AS required_visited,
        COUNT(s.id)::int AS stands_visited,
        COALESCE(
          SUM(CASE WHEN s.is_required = false THEN s.entries_weight ELSE 0 END),
          0
        ) AS optional_entries
      FROM users u
      LEFT JOIN user_stand_visits usv
        ON usv.user_id = u.id
        AND usv.event_id = $1
      LEFT JOIN stands s
        ON s.id = usv.stand_id
      GROUP BY u.id, u.email, u.username
    ),
    scored AS (
      SELECT
        pu.user_id,
        pu.email,
        pu.username,
        COALESCE(NULLIF(BTRIM(pu.username), ''), pu.email) AS display_name,
        pu.required_visited,
        et.total AS required_total,
        pu.optional_entries,
        ${raffleEntriesCaseSql} AS raffle_entries
      FROM per_user pu
      CROSS JOIN event_totals et
      CROSS JOIN stands_total st
    ),
    eligible AS (
      SELECT *
      FROM scored
      WHERE raffle_entries > 0
    )
    SELECT *
    FROM eligible
    ORDER BY raffle_entries DESC, display_name ASC, email ASC
    LIMIT 500
  `;
}

export async function getEntriesForEvent(eventId) {
  const useZeroWeightFullCompletionRule = await shouldUseZeroWeightRuleForEvent(eventId);
  const raffleEntriesCaseSql = getRaffleEntriesCaseSql();
  const entriesQuery = getEntriesQuery(raffleEntriesCaseSql);

  const { rows } = await pool.query(entriesQuery, [eventId, useZeroWeightFullCompletionRule]);

  return rows;
}

export function pickWinnerByEntries(entries) {
  const candidatesPool = entries
    .map((entry) => ({
      ...entry,
      raffle_entries: Math.max(0, Number(entry.raffle_entries || 0)),
    }))
    .filter((entry) => entry.raffle_entries > 0);

  const totalWeight = candidatesPool.reduce((acc, entry) => acc + entry.raffle_entries, 0);
  if (!candidatesPool.length || totalWeight <= 0) {
    return null;
  }

  let cursor = Math.random() * totalWeight;
  for (const candidate of candidatesPool) {
    cursor -= candidate.raffle_entries;
    if (cursor <= 0) {
      return {
        winner: candidate,
        total_weight: totalWeight,
        candidates: candidatesPool.length,
      };
    }
  }

  return {
    winner: candidatesPool[candidatesPool.length - 1],
    total_weight: totalWeight,
    candidates: candidatesPool.length,
  };
}
