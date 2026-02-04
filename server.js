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

app.listen(3000, () => {
  console.log("Backend running on http://localhost:3000");
});
