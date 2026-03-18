import express from "express";
import { authMiddleware } from "../../auth.js";
import {
  STAND_QR_TTL_SECONDS,
  getEntriesForEvent,
  isValidEmail,
  pickWinnerByEntries,
  toSafeCode,
} from "../service.js";
import { buildEntriesCsv } from "../exporters.js";
import { asyncHandler } from "../http.js";
import {
  ensureAdminAccessOrRespond,
  findStandForEvent,
  findUserByEmail,
  getEventOrRespond,
  normalizeStandCode,
  normalizeEmail,
} from "../route-helpers.js";
import {
  addStandStaffMembership,
  getEventOverviewStaff,
  getEventOverviewStands,
  removeStandStaffMembership,
  updateEventZeroWeightSetting,
  upsertConferenceAdminMembership,
} from "../repository.js";

export const conferenceAdminRouter = express.Router();

// ----- Response / Mapping Helpers -----
function toCount(value) {
  return Number(value || 0);
}

function parseExcludedUserIds(payload) {
  if (!Array.isArray(payload?.exclude_user_ids)) {
    return [];
  }
  return payload.exclude_user_ids.map((value) => String(value || "").trim()).filter(Boolean);
}

function buildWinnerResponse(picked, excludedCount) {
  return {
    success: true,
    winner: {
      user_id: picked.winner.user_id,
      email: picked.winner.email,
      username: picked.winner.username,
      display_name: picked.winner.display_name || picked.winner.username || picked.winner.email,
      required_visited: toCount(picked.winner.required_visited),
      required_total: toCount(picked.winner.required_total),
      optional_entries: toCount(picked.winner.optional_entries),
      raffle_entries: toCount(picked.winner.raffle_entries),
    },
    pool: {
      candidates: picked.candidates,
      total_weight: toCount(picked.total_weight),
      excluded_count: excludedCount,
    },
  };
}

function attachStandStaff(standRows, staffRows) {
  return standRows.map((stand) => ({
    ...stand,
    active_qr_count: toCount(stand.active_qr_count),
    unique_visitors: toCount(stand.unique_visitors),
    staff: staffRows
      .filter((staffUser) => staffUser.stand_code === stand.code)
      .map((staffUser) => ({
        id: staffUser.id,
        email: staffUser.email,
        username: staffUser.username,
        role: staffUser.role,
        created_at: staffUser.created_at,
      })),
  }));
}

function buildOverviewSummary(stands, staffRows, entries) {
  return {
    stands_total: stands.length,
    required_total: stands.filter((stand) => stand.is_required).length,
    optional_total: stands.filter((stand) => !stand.is_required).length,
    total_staff_accounts: staffRows.filter((user) => user.role === "stand_staff").length,
    total_entries_users: entries.length,
  };
}

// ----- Shared Context / Lookups -----
async function getAdminEventContext(req, res) {
  const event = await getEventOrRespond(res, req.params.eventSlug);
  if (!event) return null;

  const access = await ensureAdminAccessOrRespond(res, event.id, req.user.id);
  if (!access) return null;

  return { event, access };
}

async function getStandForEventOrRespond(res, eventId, rawStandCode, selectFields = "id, code, name") {
  const stand = await findStandForEvent(eventId, normalizeStandCode(rawStandCode), selectFields);
  if (!stand) {
    res.status(404).json({ error: "Stand not found for event" });
    return null;
  }
  return stand;
}

// ----- Admin Endpoints -----

conferenceAdminRouter.get(
  "/admin/events/:eventSlug/export/entries.csv",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const context = await getAdminEventContext(req, res);
    if (!context) return;

    const { event } = context;

    const entries = await getEntriesForEvent(event.id);
    const csv = buildEntriesCsv(entries);
    const safeSlug = toSafeCode(event.slug || "event");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeSlug}-raffle-entries.csv"`
    );
    res.status(200).send(csv);
  })
);

conferenceAdminRouter.post(
  "/admin/events/:eventSlug/pick-winner",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const context = await getAdminEventContext(req, res);
    if (!context) return;

    const { event } = context;

    const excludedUserIds = parseExcludedUserIds(req.body);

    const entries = await getEntriesForEvent(event.id);
    const eligibleEntries = excludedUserIds.length
      ? entries.filter((entry) => !excludedUserIds.includes(String(entry.user_id)))
      : entries;

    const picked = pickWinnerByEntries(eligibleEntries);
    if (!picked) {
      return res.status(409).json({
        error: "No eligible entries available to pick a winner",
        code: "no_eligible_entries",
      });
    }

    res.json(buildWinnerResponse(picked, excludedUserIds.length));
  })
);

conferenceAdminRouter.get(
  "/admin/events/:eventSlug/overview",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const context = await getAdminEventContext(req, res);
    if (!context) return;

    const { event } = context;

    const [standRows, staffRows, entries] = await Promise.all([
      getEventOverviewStands(event.id),
      getEventOverviewStaff(event.id),
      getEntriesForEvent(event.id),
    ]);

    const stands = attachStandStaff(standRows, staffRows);
    const summary = buildOverviewSummary(stands, staffRows, entries);

    res.json({
      event,
      ttl_seconds: STAND_QR_TTL_SECONDS,
      summary,
      stands,
      staff: staffRows,
      entries,
    });
  })
);

conferenceAdminRouter.patch(
  "/admin/events/:eventSlug/settings",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const context = await getAdminEventContext(req, res);
    if (!context) return;

    const { event } = context;

    if (req.body.zero_weight_full_completion_single_entry === undefined) {
      return res.status(400).json({
        error: "zero_weight_full_completion_single_entry is required",
      });
    }

    const nextValue = Boolean(req.body.zero_weight_full_completion_single_entry);
    const updated = await updateEventZeroWeightSetting(event.id, nextValue);

    res.json({ success: true, event: updated });
  })
);

conferenceAdminRouter.post(
  "/admin/events/:eventSlug/staff",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const context = await getAdminEventContext(req, res);
    if (!context) return;

    const { event } = context;

    const { email, stand_code: standCode } = req.body;
    if (!email || !standCode) {
      return res.status(400).json({ error: "email and stand_code are required" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "email invalido" });
    }

    const stand = await getStandForEventOrRespond(res, event.id, standCode);
    if (!stand) return;

    const staffUser = await findUserByEmail(email);
    if (!staffUser) {
      return res.status(404).json({
        error: "El usuario no existe. Debe registrarse antes de asignar permisos de stand.",
      });
    }

    await addStandStaffMembership(staffUser.id, event.id, stand.id);

    res.status(201).json({
      success: true,
      staff: {
        ...staffUser,
        role: "stand_staff",
        stand_code: stand.code,
        stand_name: stand.name,
      },
    });
  })
);

conferenceAdminRouter.post(
  "/admin/events/:eventSlug/admins",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const context = await getAdminEventContext(req, res);
    if (!context) return;

    const { event } = context;

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "email invalido" });
    }

    const adminUser = await findUserByEmail(email);
    if (!adminUser) {
      return res.status(404).json({
        error: "El usuario no existe. Debe registrarse antes de promoverse a administrador.",
      });
    }

    await upsertConferenceAdminMembership(adminUser.id, event.id);

    res.status(201).json({
      success: true,
      admin: {
        ...adminUser,
        role: "conference_admin",
      },
    });
  })
);

conferenceAdminRouter.post(
  "/admin/events/:eventSlug/stands/:standCode/staff",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const context = await getAdminEventContext(req, res);
    if (!context) return;

    const { event } = context;

    const { email } = req.body;
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "email invalido" });
    }

    const stand = await getStandForEventOrRespond(res, event.id, req.params.standCode);
    if (!stand) return;

    const staffUser = await findUserByEmail(email, "id, email, username");
    if (!staffUser) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    await addStandStaffMembership(staffUser.id, event.id, stand.id);

    res.status(201).json({
      success: true,
      staff: {
        id: staffUser.id,
        email: staffUser.email,
        username: staffUser.username,
        stand_code: stand.code,
        stand_name: stand.name,
      },
    });
  })
);

conferenceAdminRouter.delete(
  "/admin/events/:eventSlug/stands/:standCode/staff",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const context = await getAdminEventContext(req, res);
    if (!context) return;

    const { event } = context;

    const standCode = req.params.standCode;
    const email = normalizeEmail(req.body?.email);
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "email invalido" });
    }

    const stand = await getStandForEventOrRespond(res, event.id, standCode, "id");
    if (!stand) return;

    const user = await findUserByEmail(email, "id");
    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    await removeStandStaffMembership(user.id, event.id, stand.id);
    res.json({ success: true });
  })
);
