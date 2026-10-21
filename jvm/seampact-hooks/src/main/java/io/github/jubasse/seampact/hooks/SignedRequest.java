package io.github.jubasse.seampact.hooks;

/** The signature fields of a signed identity's request: a template scheme's, or a {@code verify: application} one's. */
public sealed interface SignedRequest permits SignedTemplateRequest, SignedApplicationRequest {}
