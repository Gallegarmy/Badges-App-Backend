function readRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }

  return parsed;
}

export const config = {
  server: {
    host: process.env.HOST ?? "0.0.0.0",
    port: readPositiveIntegerEnv("PORT", 3000),
  },
  database: {
    url: readRequiredEnv("DATABASE_URL"),
  },
  auth: {
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
    jwtSecret: readRequiredEnv("JWT_SECRET"),
  },
  badges: {
    expirationMonths: readPositiveIntegerEnv("BADGE_EXPIRATION_MONTHS", 3),
    qrTokenTtlHours: readPositiveIntegerEnv("QR_TOKEN_TTL_HOURS", 2),
  },
} as const;
