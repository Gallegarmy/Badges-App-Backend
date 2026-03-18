import express from "express";
import { conferenceAdminRouter } from "./conference/routes/admin-routes.js";
import { conferencePublicRouter } from "./conference/routes/public-routes.js";
import { conferenceStandRouter } from "./conference/routes/stand-routes.js";

export const conferenceRouter = express.Router();

conferenceRouter.use(conferencePublicRouter);
conferenceRouter.use(conferenceStandRouter);
conferenceRouter.use(conferenceAdminRouter);
