import { expect, test } from "vitest";
import vectors from "../../../core/spec/vectors/ir/header-values.json" with { type: "json" };
import { successorLink } from "./response-headers.js";

// The successor link the boundary writes, against the IR's shared header vectors: each path param decoded, then
// encoded again as one path segment, so no value breaks out of the link. The route table refuses absolute urls,
// so the relative vectors are the ones a Node server writes.

const relativeLinks = vectors.cases.filter(
  (vector) => vector.header === "successorLink" && vector.fragment.wire?.urls === "relative",
);

test("the relative successor link vectors are read", () => {
  expect(relativeLinks.length).toBeGreaterThan(0);
});

test.each(relativeLinks.map((vector) => [vector.id, vector] as const))("%s", (_, vector) => {
  const encodedPathParams = Object.fromEntries(
    Object.entries(vector.request.pathParams ?? {}).map(([name, value]) => [
      name,
      encodeURIComponent(String(value)),
    ]),
  );
  const rel = String(vector.fragment.deprecated?.successorRel);

  expect(successorLink(String(vector.fragment.successorPath), rel, encodedPathParams)).toBe(
    vector.expected,
  );
});

test("a successor path naming a param the request has not is an error, never an empty segment", () => {
  expect(() => successorLink("/v2/tasks/{taskId}", "successor-version", {})).toThrow(
    "names the param 'taskId'",
  );
});
