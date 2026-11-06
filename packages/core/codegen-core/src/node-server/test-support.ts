// The test support the Node server targets share: the generated reference project, live requests to a test app and
// the access forms 1.0 refuses (native access among them), the rights-version header form and the links of a client
// target; the client targets share the IR reading proofs.

export * from "./forms-refused.test-support.js";
export * from "./generation-proofs.test-support.js";
export * from "./ir-reading.test-support.js";
export * from "./live-debug-exceptions.test-support.js";
export * from "./live-handler-access.test-support.js";
export * from "./live-pages.test-support.js";
export * from "./live-query-lists.test-support.js";
export * from "./live-request.test-support.js";
export * from "./live-response-headers.test-support.js";
export * from "./native-access-refused.test-support.js";
export * from "./native-docs-agreement.test-support.js";
export * from "./reference-project.test-support.js";
export * from "./rights-version-header.test-support.js";
export * from "./types-links.test-support.js";
export * from "./unknown-keys-refused.test-support.js";
