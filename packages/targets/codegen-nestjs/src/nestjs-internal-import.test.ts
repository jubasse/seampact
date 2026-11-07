import "reflect-metadata";
import { expect, test } from "vitest";

// The boot check's cache probe builds its execution context with this class, which NestJS exports only from
// `@nestjs/core/internal`. A NestJS update that moves it fails here, by name, before the generated runtime's compile.
test("ExecutionContextHost, which the cache probe builds its context with, is exported by @nestjs/core/internal", async () => {
  const internal: Record<string, unknown> = await import("@nestjs/core/internal");

  expect(typeof internal.ExecutionContextHost).toBe("function");
});
