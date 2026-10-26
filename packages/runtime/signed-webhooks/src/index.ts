// The template signature verifier an authenticate hook calls for a signed identity (ADR 0013): HMAC over the raw
// body, timestamp tolerance and secret rotation; the application keeps its secrets.
export {
  EmptySignatureSecretError,
  type SecretLookup,
  type SignatureFailure,
  SignaturePayloadInvalidError,
  SignatureToleranceInvalidError,
  type SignatureVerification,
  SUPPORTED_ALGORITHM,
  UnsupportedSignatureAlgorithmError,
  type VerifyTemplateSignatureOptions,
  verifyTemplateSignature,
} from "./verify-template-signature.js";
