import type {
  Awaitable,
  ErrorCodeWithParams,
  ExtensionMetadata,
  OperationRef,
  RequestView,
} from "./hook-vocabulary.js";

/** How a template scheme signs, copied from the scheme's `signature` so a helper needs only a secret lookup. */
export interface SignatureTemplate {
  readonly algorithm: string;

  /** The signed bytes, a template with `{rawBody}` and at most one `{ts}`. */
  readonly payload: string;

  readonly encoding: "hex" | "base64";

  /** Present exactly when the payload signs `{ts}`. */
  readonly toleranceMs?: number;
}

/** A request to a template scheme: the boundary has parsed the signature header but verified nothing. */
export interface SignedTemplateRequest {
  readonly verify: "template";

  /** The body as received, decoded when the request has a `Content-Encoding`, never re-serialized. */
  readonly rawBody: Uint8Array;

  /** The `{ts}` text as received, so the payload is rebuilt byte for byte; absent when the format has no `{ts}`. */
  readonly timestamp?: string;

  /** Every `{sig}` value the header carries, still encoded. */
  readonly candidateSignatures: readonly string[];

  /** The key id from the scheme's `key`, which chooses the secret set. */
  readonly keyId: string;

  readonly template: SignatureTemplate;
}

/** A request to a `verify: application` scheme: the hook verifies with its own library. */
export interface SignedApplicationRequest {
  readonly verify: "application";

  /** The body as received, decoded when the request has a `Content-Encoding`, never re-serialized. */
  readonly rawBody: Uint8Array;

  /** The signature header value, unparsed. */
  readonly signatureHeader: string;

  /** The scheme's declared headers by lower-case name, unparsed; a header the request lacks is absent. */
  readonly headers: Readonly<Record<string, string>>;

  /** The key id from the scheme's `key`, when it declares one. */
  readonly keyId?: string;
}

/** What the authenticate hook of one identity receives; the generated request type narrows each member. */
export interface AuthenticateRequest<
  Credentials extends object = Readonly<Record<string, unknown>>,
  Extensions extends object = ExtensionMetadata,
> {
  readonly identity: string;

  /** The credentials found in the locations the identity's schemes declare for this request. */
  readonly credentials: Credentials;

  /** The CSRF companion value, on a write authenticated by a cookie scheme that declares `csrf`. */
  readonly csrfToken?: string;

  /** Present for a signed identity. */
  readonly signature?: SignedTemplateRequest | SignedApplicationRequest;

  readonly request: RequestView;
  readonly operation: OperationRef;

  /** The operation's extension values. */
  readonly extensions: Extensions;
}

/** A principal, or a denial naming one of the identity's declared codes. */
export type AuthenticateResult<Principal, Denial extends ErrorCodeWithParams> =
  | { readonly principal: Principal; readonly deny?: never }
  | { readonly deny: Denial; readonly principal?: never };

/** One per identity; called only when a declared credential is present. */
export interface AuthenticateHook<
  Request extends AuthenticateRequest<object, object>,
  Principal,
  Denial extends ErrorCodeWithParams,
> {
  authenticate(request: Request): Awaitable<AuthenticateResult<Principal, Denial>>;
}
