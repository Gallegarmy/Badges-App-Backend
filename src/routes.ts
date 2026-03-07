import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { authenticate } from "./auth.ts";
import { config } from "./config.ts";
import { pool } from "./db.ts";
import { HttpError } from "./http.ts";

interface RegisterBody {
  email?: string;
  password?: string;
  username?: string;
}

interface LoginBody {
  email?: string;
  password?: string;
}

interface CreateQrBody {
  badge_id?: string;
}

interface ClaimQrBody {
  token?: string;
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${field} is required`);
  }

  return value.trim();
}

function buildBadgeExpirationDate() {
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + config.badges.expirationMonths);
  return expiresAt;
}

export async function registerRoutes(app: FastifyInstance) {
  app.post<{ Body: RegisterBody }>(
    "/auth/register",
    async (request, reply) => {
      const { email, username, password } = request.body;

      const normalizedEmail = requireString(email, "email").toLowerCase();
      const normalizedUsername = requireString(username, "username");
      const normalizedPassword = requireString(password, "password");
      const passwordHash = await bcrypt.hash(normalizedPassword, 10);

      await pool.query(
        "INSERT INTO users(email, username, password_hash) VALUES ($1, $2, $3)",
        [normalizedEmail, normalizedUsername, passwordHash],
      );

      return reply.code(201).send({ success: true });
    },
  );

  app.post<{ Body: LoginBody }>(
    "/auth/login",
    async (request) => {
      const { email, password } = request.body;
      const normalizedEmail = requireString(email, "email").toLowerCase();
      const normalizedPassword = requireString(password, "password");
      const result = await pool.query(
        "SELECT id, password_hash FROM users WHERE email = $1",
        [normalizedEmail],
      );

      if (result.rows.length === 0) {
        throw new HttpError(401, "Invalid login");
      }

      const [user] = result.rows;
      const validPassword = await bcrypt.compare(
        normalizedPassword,
        user.password_hash,
      );

      if (!validPassword) {
        throw new HttpError(401, "Invalid login");
      }

      const token = jwt.sign({ id: user.id }, config.auth.jwtSecret, {
        expiresIn: config.auth.jwtExpiresIn as SignOptions["expiresIn"],
      });

      return { token };
    },
  );

  app.get(
    "/my-badges",
    { preHandler: authenticate },
    async (request) => {
      const result = await pool.query(
        `
          SELECT b.name, b.image_url, ub.expires_at
          FROM user_badges ub
          JOIN badges b ON b.id = ub.badge_id
          WHERE ub.user_id = $1
            AND (ub.expires_at IS NULL OR ub.expires_at > now())
        `,
        [request.user.id],
      );

      return result.rows;
    },
  );

  app.get("/badges-list", async () => {
    const result = await pool.query(
      `
          SELECT
            u.username,
            COUNT(ub.badge_id)::int AS badge_count
          FROM user_badges ub
          JOIN users u ON u.id = ub.user_id
          GROUP BY u.id, u.username
          ORDER BY badge_count DESC
          LIMIT 10
        `,
    );

    return result.rows;
  });

  app.post<{ Body: CreateQrBody }>(
    "/qr/create",
    async (request) => {
      const { badge_id } = request.body;
      const badgeId = requireString(badge_id, "badge_id");
      const token = randomUUID();
      const expiresAt = new Date(
        Date.now() + config.badges.qrTokenTtlHours * 60 * 60 * 1000,
      );

      await pool.query("DELETE FROM qr_codes WHERE expires_at < now()");
      await pool.query(
        "INSERT INTO qr_codes(token, badge_id, expires_at) VALUES ($1, $2, $3)",
        [token, badgeId, expiresAt],
      );

      return { token };
    },
  );

  app.post<{ Body: ClaimQrBody }>(
    "/qr/claim",
    { preHandler: authenticate },
    async (request) => {
      const { token } = request.body;
      const qrToken = requireString(token, "token");
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const qrResult = await client.query(
          `
            SELECT id, badge_id
            FROM qr_codes
            WHERE token = $1
              AND expires_at > now()
            FOR UPDATE
          `,
          [qrToken],
        );

        if (qrResult.rows.length === 0) {
          throw new HttpError(400, "Invalid QR");
        }

        const [qrCode] = qrResult.rows;
        const badgeResult = await client.query(
          "SELECT is_permanent FROM badges WHERE id = $1",
          [qrCode.badge_id],
        );

        if (badgeResult.rows.length === 0) {
          throw new HttpError(404, "Badge not found");
        }

        const existingBadgeResult = await client.query(
          "SELECT 1 FROM user_badges WHERE badge_id = $1 AND user_id = $2",
          [qrCode.badge_id, request.user.id],
        );

        if (existingBadgeResult.rows.length > 0) {
          throw new HttpError(403, "Badge already attained");
        }

        const [badge] = badgeResult.rows;
        const expiresAt = badge.is_permanent
          ? null
          : buildBadgeExpirationDate();

        await client.query(
          "INSERT INTO user_badges(user_id, badge_id, expires_at) VALUES ($1, $2, $3)",
          [request.user.id, qrCode.badge_id, expiresAt],
        );
        await client.query("DELETE FROM qr_codes WHERE id = $1", [qrCode.id]);

        await client.query("COMMIT");
        return { success: true };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );
}
