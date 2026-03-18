import express from "express";
import { v4 as uuid } from "uuid";
import { pool } from "../../db.js";
import { authMiddleware } from "../../auth.js";
import {
  STAND_QR_IS_PERSISTENT,
  STAND_QR_TTL_SECONDS,
  getAccessForUser,
  getEntriesForEvent,
  getOptionalAuthUser,
  getStandQrExpiryDate,
  shouldUseZeroWeightFullCompletionRule,
} from "../service.js";
import { asyncHandler } from "../http.js";
import {
  STAND_CODE_REGEX,
  ensureAdminAccessOrRespond,
  getEventOrRespond,
  normalizeStandCode,
} from "../route-helpers.js";

export const conferenceStandRouter = express.Router();

// ----- QR Creation Helpers -----
function parseStandCode(rawValue) {
  if (typeof rawValue !== "string") return rawValue;
  return normalizeStandCode(rawValue);
}

async function resolveQrCreateAccess(res, eventId, user, requestedStandCode) {
  let standCode = requestedStandCode;
  let standIdsAllowed = [];

  if (!user) {
    res.status(401).json({ error: "No token" });
    return null;
  }

  const access = await getAccessForUser(eventId, user.id);
  if (!access.is_admin && !access.is_stand_staff) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  if (access.is_admin) {
    if (!standCode) {
      res.status(400).json({ error: "stand_code is required" });
      return null;
    }
  } else {
    standIdsAllowed = access.stands.map((s) => s.stand_id);
    if (!standCode && access.stands.length) {
      standCode = access.stands[0].stand_code;
    }
    if (!standCode) {
      res.status(400).json({ error: "stand_code is required" });
      return null;
    }
  }

  return { standCode, standIdsAllowed };
}

async function findStandOrRespond(res, eventId, standCode) {
  const standLookup = await pool.query(
    `
      SELECT s.id AS stand_id, s.name AS stand_name, s.code AS stand_code
      FROM stands s
      WHERE s.event_id = $1 AND s.code = $2
      `,
    [eventId, standCode]
  );

  if (!standLookup.rows.length) {
    res.status(404).json({ error: "Stand not found for event" });
    return null;
  }

  return standLookup.rows[0];
}

async function findPersistentQrToken(standId) {
  if (!STAND_QR_IS_PERSISTENT) {
    return null;
  }

  const existingQr = await pool.query(
    `
        SELECT token, expires_at
        FROM stand_qr_codes
        WHERE stand_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        `,
    [standId]
  );

  if (!existingQr.rows.length) {
    return null;
  }

  return {
    token: existingQr.rows[0].token,
    expires: existingQr.rows[0].expires_at,
  };
}

async function createQrToken(standId) {
  const token = uuid();
  const expires = getStandQrExpiryDate();

  if (!STAND_QR_IS_PERSISTENT) {
    await pool.query("DELETE FROM stand_qr_codes WHERE stand_id = $1", [standId]);
  }

  await pool.query("INSERT INTO stand_qr_codes(token, stand_id, expires_at) VALUES ($1,$2,$3)", [
    token,
    standId,
    expires,
  ]);

  return { token, expires };
}

async function getOrCreateStandQrToken(standId) {
  const existing = await findPersistentQrToken(standId);
  if (existing) return existing;
  return createQrToken(standId);
}

function buildClaimUrl(token) {
  const frontendBase = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
  const claimPath = `/stand-claim.html?token=${encodeURIComponent(token)}`;
  return frontendBase ? `${frontendBase}${claimPath}` : claimPath;
}

// ----- QR Claim Helpers -----
async function findClaimDataByToken(token) {
  const { rows } = await pool.query(
    `
      SELECT sqc.stand_id, s.event_id, s.code AS stand_code, s.name AS stand_name,
             s.is_required, s.entries_weight, s.badge_id,
             b.name AS badge_name,
             e.slug AS event_slug
      FROM stand_qr_codes sqc
      JOIN stands s ON s.id = sqc.stand_id
      LEFT JOIN badges b ON b.id = s.badge_id
      JOIN events e ON e.id = s.event_id
      WHERE sqc.token = $1
        AND sqc.expires_at > now()
        AND e.is_active = true
        AND e.starts_at <= now()
        AND e.ends_at >= now()
      ORDER BY sqc.expires_at DESC
      LIMIT 1
      `,
    [token]
  );

  return rows[0] || null;
}

async function registerStandVisit(userId, standData) {
  return pool.query(
    `
      INSERT INTO user_stand_visits(user_id, event_id, stand_id)
      VALUES ($1,$2,$3)
      ON CONFLICT (user_id, event_id, stand_id) DO NOTHING
      RETURNING id
      `,
    [userId, standData.event_id, standData.stand_id]
  );
}

async function resolveBadgeAward(userId, badgeId) {
  if (!badgeId) {
    return { badgeAwarded: false, badgeAlreadyOwned: false };
  }

  const badgeResult = await pool.query("SELECT id, is_permanent FROM badges WHERE id = $1", [badgeId]);
  if (!badgeResult.rows.length) {
    return { badgeAwarded: false, badgeAlreadyOwned: false };
  }

  const existingBadge = await pool.query(
    "SELECT id FROM user_badges WHERE badge_id = $1 AND user_id = $2",
    [badgeId, userId]
  );

  if (existingBadge.rows.length) {
    return { badgeAwarded: false, badgeAlreadyOwned: true };
  }

  let expiresAt = null;
  if (!badgeResult.rows[0].is_permanent) {
    expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 3);
  }

  await pool.query("INSERT INTO user_badges(user_id, badge_id, expires_at) VALUES ($1,$2,$3)", [
    userId,
    badgeId,
    expiresAt,
  ]);

  return { badgeAwarded: true, badgeAlreadyOwned: false };
}

function buildClaimResponse(standData, insertVisit, badgeAwarded, badgeAlreadyOwned) {
  const alreadyRegistered = !insertVisit.rows.length;

  if (alreadyRegistered) {
    return {
      success: true,
      already_registered: true,
      stand_name: standData.stand_name,
      stand_code: standData.stand_code,
      event_slug: standData.event_slug,
      badge_name: standData.badge_name || null,
      badge_claimed: false,
      badge_awarded: badgeAwarded,
      badge_already_owned: badgeAlreadyOwned,
    };
  }

  return {
    success: true,
    already_registered: false,
    stand_name: standData.stand_name,
    stand_code: standData.stand_code,
    event_slug: standData.event_slug,
    badge_name: standData.badge_name || null,
    badge_claimed: badgeAwarded,
    is_required: standData.is_required,
    entries_weight: standData.entries_weight,
    badge_awarded: badgeAwarded,
    badge_already_owned: badgeAlreadyOwned,
  };
}

// ----- Progress Helpers -----
function buildProgressSummary(event, rows) {
  const requiredStands = rows.filter((stand) => stand.is_required);
  const optionalStands = rows.filter((stand) => !stand.is_required);
  const requiredTotal = requiredStands.length;
  const requiredVisited = requiredStands.filter((stand) => stand.visited).length;
  const optionalVisited = optionalStands.filter((stand) => stand.visited).length;
  const optionalEntriesEarned = optionalStands
    .filter((stand) => stand.visited)
    .reduce((acc, stand) => acc + Number(stand.entries_weight || 0), 0);

  const useZeroWeightFullCompletionRule = shouldUseZeroWeightFullCompletionRule(event, rows);
  const allStandsVisited = rows.length > 0 && rows.every((stand) => stand.visited);
  const eligibleForRaffle = useZeroWeightFullCompletionRule
    ? allStandsVisited
    : requiredTotal === 0 || requiredVisited === requiredTotal;
  const raffleEntries = useZeroWeightFullCompletionRule
    ? (eligibleForRaffle ? 1 : 0)
    : (eligibleForRaffle ? 1 + optionalEntriesEarned : 0);

  return {
    required_total: requiredTotal,
    required_visited: requiredVisited,
    optional_total: optionalStands.length,
    optional_visited: optionalVisited,
    optional_entries_earned: optionalEntriesEarned,
    zero_weight_full_completion_mode: useZeroWeightFullCompletionRule,
    eligible_for_raffle: eligibleForRaffle,
    raffle_entries: raffleEntries,
  };
}

conferenceStandRouter.post(
  "/events/:eventSlug/stands/qr/create",
  asyncHandler(async (req, res) => {
    const event = await getEventOrRespond(res, req.params.eventSlug, { onlyActive: true });
    if (!event) return;

    const authenticatedUser = getOptionalAuthUser(req);
    const requestedStandCode = parseStandCode(req.body.stand_code);
    const accessScope = await resolveQrCreateAccess(
      res,
      event.id,
      authenticatedUser,
      requestedStandCode
    );
    if (!accessScope) return;

    const { standCode, standIdsAllowed } = accessScope;

    if (standCode && !STAND_CODE_REGEX.test(standCode)) {
      return res.status(400).json({ error: "stand_code invalido" });
    }

    const stand = await findStandOrRespond(res, event.id, standCode);
    if (!stand) return;

    if (standIdsAllowed.length && !standIdsAllowed.includes(stand.stand_id)) {
      return res.status(403).json({ error: "Forbidden for selected stand" });
    }

    await pool.query("DELETE FROM stand_qr_codes WHERE expires_at < now()");
    const { token, expires } = await getOrCreateStandQrToken(stand.stand_id);

    res.json({
      token,
      stand_code: stand.stand_code,
      stand_name: stand.stand_name,
      expires_at: STAND_QR_IS_PERSISTENT ? null : new Date(expires).toISOString(),
      ttl_seconds: STAND_QR_IS_PERSISTENT ? null : STAND_QR_TTL_SECONDS,
      qr_persistent: STAND_QR_IS_PERSISTENT,
      claim_url: buildClaimUrl(token),
    });
  })
);

// ----- Stand Endpoints -----
conferenceStandRouter.post(
  "/stands/qr/claim",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const rawToken = req.body?.token;
    const token = String(rawToken || "").trim();
    if (!token) {
      return res.status(400).json({ error: "token is required" });
    }

    const standData = await findClaimDataByToken(token);
    if (!standData) {
      return res.status(400).json({
        error: "Invalid or expired stand QR",
        code: "stand_qr_invalid_or_expired",
      });
    }

    const insertVisit = await registerStandVisit(req.user.id, standData);
    const { badgeAwarded, badgeAlreadyOwned } = await resolveBadgeAward(req.user.id, standData.badge_id);

    res.json(buildClaimResponse(standData, insertVisit, badgeAwarded, badgeAlreadyOwned));
  })
);

conferenceStandRouter.get(
  "/events/:eventSlug/progress",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const event = await getEventOrRespond(res, req.params.eventSlug);
    if (!event) return;

    const { rows } = await pool.query(
      `
      SELECT
        s.id,
        s.code,
        s.name,
        s.is_required,
        s.entries_weight,
        CASE WHEN usv.id IS NOT NULL THEN true ELSE false END AS visited,
        usv.scanned_at
      FROM stands s
      LEFT JOIN user_stand_visits usv
        ON usv.stand_id = s.id
        AND usv.user_id = $2
        AND usv.event_id = s.event_id
      WHERE s.event_id = $1
      ORDER BY s.is_required DESC, s.name ASC
      `,
      [event.id, req.user.id]
    );

    const summary = buildProgressSummary(event, rows);

    res.json({
      event,
      summary,
      stands: rows,
    });
  })
);

conferenceStandRouter.get(
  "/events/:eventSlug/entries",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const event = await getEventOrRespond(res, req.params.eventSlug);
    if (!event) return;
    const access = await ensureAdminAccessOrRespond(res, event.id, req.user.id);
    if (!access) return;

    const rows = await getEntriesForEvent(event.id);
    res.json(rows);
  })
);
