// Type-level assertions, checked by `tsc`: a denial names only the codes its request declares, with their params.
import type { Decision, DecideHook, DeniableCodes, RequirementRequest } from "./decide.js";

type NotProjectMember = {
  readonly code: "notProjectMember";
  readonly params: { readonly projectId: string };
};
type RateLimited = {
  readonly code: "rateLimited";
  readonly params: { readonly retryAfterSeconds: number };
};

type EditTaskRequest = RequirementRequest<NotProjectMember | RateLimited>;

type AcceptedDecision<Allowed extends Decision<DeniableCodes<EditTaskRequest>>> = Allowed;

export type AllowCompiles = AcceptedDecision<{ readonly allow: true }>;

export type DeclaredCodeCompiles = AcceptedDecision<{
  readonly deny: {
    readonly code: "notProjectMember";
    readonly params: { readonly projectId: "p1" };
  };
}>;

type TaskArchivedDenial = {
  readonly deny: { readonly code: "taskArchived"; readonly params: { readonly projectId: "p1" } };
};

// @ts-expect-error a code the request does not declare
export type UndeclaredCodeFails = AcceptedDecision<TaskArchivedDenial>;

type RateLimitedWithMemberParams = {
  readonly deny: { readonly code: "rateLimited"; readonly params: { readonly projectId: "p1" } };
};

// @ts-expect-error params of another declared code
export type WrongParamsFail = AcceptedDecision<RateLimitedWithMemberParams>;

export type EditTaskDecider = DecideHook<EditTaskRequest>;
