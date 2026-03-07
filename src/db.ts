import { Pool } from "pg";
import { config } from "./config.ts";

export const pool = new Pool({
  connectionString: config.database.url,
});

pool.on("error", (error: Error) => {
  console.error("Unexpected error on idle Postgres client", error);
});

export async function closePool() {
  await pool.end();
}
