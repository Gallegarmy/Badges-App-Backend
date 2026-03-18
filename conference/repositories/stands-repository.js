import { pool } from "../../db.js";

export async function findStandByEventAndCode(eventId, standCode, selectFields = "id, code, name") {
  const { rows } = await pool.query(
    `
    SELECT ${selectFields}
    FROM stands
    WHERE event_id = $1 AND code = $2
    `,
    [eventId, standCode]
  );

  return rows[0] || null;
}

export async function getEventOverviewStands(eventId) {
  const { rows } = await pool.query(
    `
    SELECT
      s.id,
      s.code,
      s.name,
      s.is_required,
      s.entries_weight,
      s.badge_id,
      b.name AS badge_name,
      COUNT(DISTINCT sqc.id) FILTER (WHERE sqc.expires_at > now()) AS active_qr_count,
      MAX(sqc.expires_at) FILTER (WHERE sqc.expires_at > now()) AS active_qr_expires_at,
      COUNT(DISTINCT usv.user_id) AS unique_visitors
    FROM stands s
    LEFT JOIN badges b ON b.id = s.badge_id
    LEFT JOIN stand_qr_codes sqc ON sqc.stand_id = s.id
    LEFT JOIN user_stand_visits usv ON usv.stand_id = s.id AND usv.event_id = s.event_id
    WHERE s.event_id = $1
    GROUP BY s.id, s.code, s.name, s.is_required, s.entries_weight, s.badge_id, b.name
    ORDER BY s.is_required DESC, s.name ASC
    `,
    [eventId]
  );

  return rows;
}
