import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import * as NotesNest from "../__generated__/server/notes/index.js";
import { AppModule } from "./app-module.js";

/** Starts the app on the port (0 picks a free one) and returns it. */
export async function startServer(port: number): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["error"] });

  NotesNest.configureApp(app);
  // The React app runs on another origin in development.
  app.enableCors();
  await app.listen(port);

  return app;
}
