import { Module } from "@nestjs/common";
import * as NotesNest from "../__generated__/server/notes/index.js";
import { inputRules } from "./input-rules.js";
import { NotesController } from "./notes-controller.js";

@Module({
  // A public api needs no hooks.
  imports: [NotesNest.SeampactModule.forRoot(undefined, { inputRules })],
  controllers: [NotesController],
})
export class AppModule {}
