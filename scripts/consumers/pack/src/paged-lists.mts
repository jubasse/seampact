// The page bodies of the paged lists under a page-number pack (pack-laravel): the handler answers its items
// and their total, and the boundary writes the pack's page around them. It replaces the template's file.
import type * as Tasks from "../generated/types/tasks/index.js";

// More tasks than one page of two holds, so a page case has a next page to follow.
const SAMPLE_TASK_TOTAL = 3;

type SuccessBody<Output> =
  Extract<Output, { status: 200 }> extends { body: infer Body } ? Body : never;

export function listChannelsPage(
  items: Tasks.schemas.Channel[],
): SuccessBody<Tasks.ListChannelsOutput> {
  return { items, total: items.length };
}

export function listTasksPage(
  items: Tasks.schemas.Task[],
  _input: Tasks.ListTasksInput,
): SuccessBody<Tasks.ListTasksOutput> {
  return { items, total: SAMPLE_TASK_TOTAL };
}
