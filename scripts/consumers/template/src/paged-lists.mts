// The page bodies of the reference contract's paged lists, whose cursor style asks the handler for its items and
// the next cursor. A pack consumer replaces this file with the page its pack's paging style asks for.
import type * as Tasks from "../generated/types/tasks/index.js";

const NEXT_CURSOR = "page-2";

type SuccessBody<Output> =
  Extract<Output, { status: 200 }> extends { body: infer Body } ? Body : never;

export function listChannelsPage(
  items: Tasks.schemas.Channel[],
): SuccessBody<Tasks.ListChannelsOutput> {
  return { items };
}

export function listTasksPage(
  items: Tasks.schemas.Task[],
  input: Tasks.ListTasksInput,
): SuccessBody<Tasks.ListTasksOutput> {
  return input.query.cursor === undefined ? { items, nextCursor: NEXT_CURSOR } : { items };
}
