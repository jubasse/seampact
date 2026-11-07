// One hook call a sample app records and the hook-calls control route answers, read the same way from a case's
// `hookCalls` and from the route, so the two compare member by member in one order.
import { arrayAt, type JsonReader, jsonAt, objectAt, stringAt } from "./json-reader.js";
import type { JsonValue } from "./suite-case.js";

/**
 * The throttle bucket a decide call received (CHK-015): its id, the values of its key sources in declared order, and
 * its limit and window in milliseconds when the contract declares them. The key digest is left out: each target
 * computes it its own way.
 */
export interface RecordedBucket {
  readonly id: string;
  readonly values: readonly JsonValue[];
  readonly limit?: number;
  readonly windowMs?: number;
}

/** One hook call the sample app records: the hook's name, the operation it ran for, and the bucket of a throttle call. */
export interface RecordedHookCall {
  readonly hook: string;
  readonly operation: string;
  readonly bucket?: RecordedBucket;
}

const HOOK_CALL_MEMBERS = ["hook", "operation", "bucket"];
const BUCKET_MEMBERS = ["id", "values", "limit", "windowMs"];

export function readRecordedHookCall(
  reader: JsonReader,
  value: unknown,
  pointer: string,
): RecordedHookCall {
  const object = objectAt(reader, value, pointer, HOOK_CALL_MEMBERS);

  return {
    hook: stringAt(reader, object.hook, `${pointer}/hook`),
    operation: stringAt(reader, object.operation, `${pointer}/operation`),
    ...(object.bucket === undefined
      ? {}
      : { bucket: readRecordedBucket(reader, object.bucket, `${pointer}/bucket`) }),
  };
}

function readRecordedBucket(reader: JsonReader, value: unknown, pointer: string): RecordedBucket {
  const object = objectAt(reader, value, pointer, BUCKET_MEMBERS);

  return {
    id: stringAt(reader, object.id, `${pointer}/id`),
    values: arrayAt(reader, object.values, `${pointer}/values`).map((item, index) =>
      jsonAt(reader, item, `${pointer}/values/${index}`),
    ),
    ...(object.limit === undefined
      ? {}
      : { limit: integerAt(reader, object.limit, `${pointer}/limit`) }),
    ...(object.windowMs === undefined
      ? {}
      : { windowMs: integerAt(reader, object.windowMs, `${pointer}/windowMs`) }),
  };
}

function integerAt(reader: JsonReader, value: unknown, pointer: string): number {
  if (!Number.isSafeInteger(value)) reader.fail(pointer, "the value is an integer");

  return Number(value);
}
