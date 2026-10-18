import type { OperationId } from "@seampact/spec/ir";

// Where a generated form comes from in the IR: a JSON Pointer, and the operation it belongs to, if any.
export interface IrLocation {
  member: string;
  operation?: OperationId;
}

export function schemaLocation(schemaId: string): IrLocation {
  return below({ member: "" }, "schemas", schemaId);
}

export function operationLocation(operationIndex: number, operationId: OperationId): IrLocation {
  return { member: `/operations/${operationIndex}`, operation: operationId };
}

// The location of a member below `location`, each segment escaped as a JSON Pointer token (RFC 6901).
export function below(location: IrLocation, ...segments: readonly (string | number)[]): IrLocation {
  const tokens = segments.map((segment) =>
    String(segment).replaceAll("~", "~0").replaceAll("/", "~1"),
  );

  return { ...location, member: `${location.member}/${tokens.join("/")}` };
}
