import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { router } from "./routes.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", router);
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on http://0.0.0.0:${PORT}`);
});
