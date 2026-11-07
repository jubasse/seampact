// Runs the http suite against the Spring Boot consumer's jars; never part of the repository's own test run.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/consumers/targets/spring-boot/suite/*.suite.ts"],
    testTimeout: 30_000,
  },
});
