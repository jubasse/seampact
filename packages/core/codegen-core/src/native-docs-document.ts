// A JSON value, as the parsed OpenAPI document of an api is passed to a target.
export type NativeDocsJson =
  | null
  | boolean
  | number
  | string
  | readonly NativeDocsJson[]
  | NativeDocsJsonObject;

export interface NativeDocsJsonObject {
  readonly [member: string]: NativeDocsJson;
}

/**
 * The seampact OpenAPI document of an api, parsed, that a target turns into its framework's own documentation
 * metadata (ADR 0009 "Artefacts and the compatibility matrix"). `name` is the `api.documents` key it was emitted
 * for, absent for an api that declares none. Present exactly when the `nativeDocs` artefact is on.
 */
export interface NativeDocsDocument {
  name?: string;
  document: NativeDocsJsonObject;
}
