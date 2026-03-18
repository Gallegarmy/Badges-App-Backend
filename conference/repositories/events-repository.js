import { pool } from "../../db.js";

export async function getActiveEventsNow() {
  const { rows } = await pool.query(
    `
    SELECT e.id, e.slug, e.name, e.description, e.starts_at, e.ends_at, e.is_active
    FROM events e
    WHERE e.is_active = true
      AND e.starts_at <= now()
      AND e.ends_at >= now()
    ORDER BY e.name ASC
    `
  );

  return rows;
}

export async function updateEventZeroWeightSetting(eventId, nextValue) {
  const { rows } = await pool.query(
    `
    UPDATE events
    SET zero_weight_full_completion_single_entry = $2
    WHERE id = $1
    RETURNING id, slug, zero_weight_full_completion_single_entry
    `,
    [eventId, nextValue]
  );

  return rows[0] || null;
}
