import { pool } from "../../db.js";

export async function getEventOverviewStaff(eventId) {
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.email,
      u.username,
      cm.role,
      cm.created_at,
      s.code AS stand_code,
      s.name AS stand_name
    FROM conference_memberships cm
    JOIN users u ON u.id = cm.user_id
    LEFT JOIN stands s ON s.id = cm.stand_id
    WHERE cm.event_id = $1
      AND cm.role IN ('conference_admin', 'stand_staff')
    ORDER BY CASE WHEN cm.role = 'conference_admin' THEN 0 ELSE 1 END,
             s.name ASC NULLS FIRST, u.username ASC
    `,
    [eventId]
  );

  return rows;
}

export async function addStandStaffMembership(userId, eventId, standId) {
  await pool.query(
    `
    INSERT INTO conference_memberships(user_id, event_id, role, stand_id)
    VALUES ($1, $2, 'stand_staff', $3)
    ON CONFLICT (user_id, event_id, stand_id)
    WHERE role = 'stand_staff'
    DO NOTHING
    `,
    [userId, eventId, standId]
  );
}

export async function removeStandStaffMembership(userId, eventId, standId) {
  await pool.query(
    `
    DELETE FROM conference_memberships
    WHERE user_id = $1
      AND event_id = $2
      AND role = 'stand_staff'
      AND stand_id = $3
    `,
    [userId, eventId, standId]
  );
}

export async function upsertConferenceAdminMembership(userId, eventId) {
  await pool.query(
    `
    INSERT INTO conference_memberships(user_id, event_id, role, stand_id)
    VALUES ($1, $2, 'conference_admin', NULL)
    ON CONFLICT (user_id, event_id)
    WHERE role = 'conference_admin'
    DO UPDATE
    SET role = EXCLUDED.role,
        stand_id = NULL
    `,
    [userId, eventId]
  );
}
