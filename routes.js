import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";
import { authMiddleware } from "./auth.js";
import { v4 as uuid } from "uuid";
import { sendResetEmail } from "./email.js";

export const router = express.Router();
const asyncHandler =
  (fn) =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);


router.post(
  "/auth/register",
  asyncHandler(async (req, res) => {
  const { email, username, password } = req.body;
  const hash = await bcrypt.hash(password, 10);

  await pool.query(
    "INSERT INTO users(email, username, password_hash) VALUES ($1,$2,$3)",
    [email, username, hash]
  );

  res.json({ success: true });
  })
);

/* LOGIN HANDLER */
router.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE email=$1",
    [email]
  );

  if (!rows.length) return res.status(401).json({ error: "Invalid login" });

  const valid = await bcrypt.compare(password, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: "Invalid login" });

  const token = jwt.sign(
    { id: rows[0].id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token });
  })
);

/* PROFILE HANDLER */
router.get(
  "/my-badges",
  authMiddleware,
  asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT b.name, b.image_url, ub.expires_at
    FROM user_badges ub
    JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id=$1
    AND (ub.expires_at IS NULL OR ub.expires_at > now())
    `,
    [req.user.id]
  );

  res.json(rows);
  })
);

router.get(
    "/badges-list", 
    asyncHandler( async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT 
          u.username, 
          COUNT(ub.badge_id) AS badge_count
        FROM user_badges ub
        JOIN users u ON u.id = ub.user_id
        GROUP BY u.id, u.username
        ORDER BY badge_count DESC
        LIMIT 10;`
      );

      res.status(200).json(result.rows);
    } catch (error) {
      console.error("Error fetching badges list:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  })
);

/* CREATE TOKEN HANDLER */
router.post(
  "/qr/create",
  asyncHandler(async (req, res) => {
  const { badge_id } = req.body;
  if (!badge_id) {
    return res.status(400).json({ error: "badge_id is required" });
  }
  const token = uuid();
  const expires = new Date(Date.now() + 2 * 60 * 60 * 1000);

  await pool.query(
    "DELETE FROM qr_codes WHERE expires_at < now()"
  );

  await pool.query(
    "INSERT INTO qr_codes(token, badge_id, expires_at) VALUES ($1,$2,$3)",
    [token, badge_id, expires]
  );

  res.json({ token });
  })
);

/* CLAIM BADGE HANDLER */
router.post(
  "/qr/claim",
  authMiddleware,
  asyncHandler(async (req, res) => {
  const { token } = req.body;

  const { rows } = await pool.query(
    "SELECT * FROM qr_codes WHERE token=$1 AND expires_at > now()",
    [token]
  );

  if (!rows.length) return res.status(400).json({ error: "Invalid QR" });

  const qr = rows[0];
  const badge = await pool.query(
    "SELECT * FROM badges WHERE id=$1",
    [qr.badge_id]
  );

  const { rows: exists } = await pool.query(
    "SELECT * FROM user_badges WHERE badge_id=$1 AND user_id=$2",
    [qr.badge_id, req.user.id]
  );

  if (exists.length >= 1)
    return res.status(403).json({error: "Badge already attained"});


  let expiresAt = null;
  if (!badge.rows[0].is_permanent) {
    expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 3);
  }

  await pool.query(
    "INSERT INTO user_badges(user_id, badge_id, expires_at) VALUES ($1,$2,$3)",
    [req.user.id, qr.badge_id, expiresAt]
  );

  await pool.query("DELETE FROM qr_codes WHERE id=$1", [qr.id]);

  res.json({ success: true });
  })
);


/* FORGOT PASSWORD HANDLER*/
router.post(
  "/auth/forgot-password",
  asyncHandler(async (req, res) => {

    const { email } = req.body;

    const { rows } = await pool.query(
      "SELECT id FROM users WHERE email=$1",
      [email]
    );

    if (!rows.length) {
      return res.json({ success: true });
    }

    const user = rows[0];

    const token = uuid();
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      "DELETE FROM password_resets WHERE expires_at < now()"
    );

    await pool.query(
      `INSERT INTO password_resets(id,user_id,token,expires_at)
       VALUES ($1,$2,$3,$4)`,
      [uuid(), user.id, token, expires]
    );

    const resetLink =
      `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

    await sendResetEmail(email, resetLink);

    res.json({ success: true });

  })
);

/* RESET PASSWORD HANDLER*/
router.post(
  "/auth/reset-password",
  asyncHandler(async (req, res) => {

    const { token, password } = req.body;

    const { rows } = await pool.query(
      "SELECT * FROM password_resets WHERE token=$1 AND expires_at > now()",
      [token]
    );

    if (!rows.length) {
      return res.status(400).json({ error: "Token inválido o expirado" });
    }

    const reset = rows[0];

    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      "UPDATE users SET password_hash=$1 WHERE id=$2",
      [hash, reset.user_id]
    );

    await pool.query(
      "DELETE FROM password_resets WHERE user_id=$1",
      [reset.user_id]
    );

    res.json({ success: true });

  })
);
