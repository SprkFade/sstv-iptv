import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import { ZodError } from "zod";
import { config } from "./config.js";
import { authMiddleware, requireAdmin, requireAuth } from "./auth/session.js";
import { authRouter } from "./routes/auth.js";
import { setupRouter } from "./routes/setup.js";
import { adminRouter } from "./routes/admin.js";
import { dataRouter } from "./routes/data.js";
import { favoritesRouter } from "./routes/favorites.js";
import { streamRouter } from "./routes/stream.js";
import { externalRouter, externalTokenStreamAuth, externalXcStreamAuth } from "./routes/external.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet({
    contentSecurityPolicy: false
  }));
  app.use(compression());
  app.use(cors({
    origin: true,
    credentials: true
  }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser(config.sessionSecret));
  app.use(authMiddleware);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/setup", setupRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", requireAdmin, adminRouter);
  app.use("/api/stream", requireAuth, streamRouter);
  app.use("/api", requireAuth, dataRouter);
  app.use("/api/favorites", requireAuth, favoritesRouter);
  app.use("/external/live/:token", externalTokenStreamAuth, streamRouter);
  app.use("/live/:username/:password", externalXcStreamAuth, streamRouter);
  app.use(externalRouter);

  app.use(express.static(config.clientDistPath, {
    maxAge: config.nodeEnv === "production" ? "1h" : 0,
    setHeaders: (res, filePath) => {
      const name = path.basename(filePath);
      if (name === "sw.js") {
        res.setHeader("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      } else if (name === "manifest.webmanifest" || filePath.includes(`${path.sep}icons${path.sep}`)) {
        res.setHeader("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("cache-control", "public, max-age=31536000, immutable");
      }
    }
  }));
  app.get(/.*/, (_req, res) => {
    res.setHeader("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.sendFile(path.join(config.clientDistPath, "index.html"));
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: "Invalid request", issues: error.flatten() });
    }
    console.error(error);
    const message = error instanceof Error ? error.message : "Unexpected server error";
    res.status(500).json({ error: message });
  });

  return app;
}
