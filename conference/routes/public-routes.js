import express from "express";
import { authMiddleware } from "../../auth.js";
import { getAccessForUser, getDestinationForAccess } from "../service.js";
import { asyncHandler } from "../http.js";
import { getEventOrRespond, getRoleFromAccess } from "../route-helpers.js";
import { getActiveEventsNow } from "../repository.js";

export const conferencePublicRouter = express.Router();

// ----- Response Builders -----
function buildActiveEventCard(eventRow, access) {
  return {
    slug: eventRow.slug,
    name: eventRow.name,
    description: eventRow.description || "",
    starts_at: eventRow.starts_at,
    ends_at: eventRow.ends_at,
    is_active: eventRow.is_active,
    role: getRoleFromAccess(access),
    stand_count: access.stands.length,
    stands: access.stands,
    can_access_admin: access.is_admin,
    can_opt_in: true,
  };
}

function buildOptInResponse(event, access, destination) {
  return {
    success: true,
    event: {
      id: event.id,
      slug: event.slug,
      name: event.name,
      description: event.description || "",
      starts_at: event.starts_at,
      ends_at: event.ends_at,
    },
    access: {
      role: getRoleFromAccess(access),
      is_admin: access.is_admin,
      is_stand_staff: access.is_stand_staff,
      stands: access.stands,
    },
    destination,
  };
}

// ----- Public Endpoints -----

conferencePublicRouter.get(
  "/conference/events/active",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const rows = await getActiveEventsNow();

    const events = await Promise.all(
      rows.map(async (row) => {
        const access = await getAccessForUser(row.id, req.user.id);
        return buildActiveEventCard(row, access);
      })
    );

    res.json({ events });
  })
);

conferencePublicRouter.post(
  "/conference/events/:eventSlug/opt-in",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const event = await getEventOrRespond(
      res,
      req.params.eventSlug,
      { onlyActive: true },
      "Active event not found"
    );
    if (!event) return;

    const access = await getAccessForUser(event.id, req.user.id);
    const destination = getDestinationForAccess(access);

    res.json(buildOptInResponse(event, access, destination));
  })
);
