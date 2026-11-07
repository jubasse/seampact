"""A signed request: by a template scheme the verifier checks, or by one the application checks."""

from seampact.hooks.signed_application_request import SignedApplicationRequest
from seampact.hooks.signed_template_request import SignedTemplateRequest

type SignedRequest = SignedTemplateRequest | SignedApplicationRequest
