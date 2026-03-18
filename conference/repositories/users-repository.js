import { pool } from "../../db.js";

export async function findUserByEmailQuery(email, selectFields = "id, email, username, created_at") {
  const { rows } = await pool.query(
    `
    SELECT ${selectFields}
    FROM users
    WHERE email = $1
    `,
    [email]
  );

  return rows[0] || null;
}
