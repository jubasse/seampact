// Type-level assertions, checked by `tsc`: a denial names only the codes its request declares, with their params.
import type { AuthenticateResult } from "./authenticate.js";
import type { Decision, DecideHook, DeniableCodes, RequirementRequest } from "./decide.js";
import type { ScopeResolution, ResolvedScope } from "./resolve-scope.js";

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

// @ts-expect-error a decision with both arms
export type BothDecisionArmsFail = AcceptedDecision<{
  readonly allow: true;
  readonly deny: {
    readonly code: "notProjectMember";
    readonly params: { readonly projectId: "p1" };
  };
}>;

// @ts-expect-error a decision with neither arm
export type NoDecisionArmFails = AcceptedDecision<{}>;

type Accepted<Expected, Actual extends Expected> = Actual;

type Account = { readonly userId: string };
type AccountResult = AuthenticateResult<Account, NotProjectMember>;
type ProjectScope = ResolvedScope<string>;
type ProjectResolution = ScopeResolution<ProjectScope, NotProjectMember>;

type MemberDenial = {
  readonly code: "notProjectMember";
  readonly params: { readonly projectId: "p1" };
};

export type PrincipalAlone = Accepted<
  AccountResult,
  { readonly principal: { readonly userId: "u1" } }
>;

export type BothAuthenticateArmsFail = Accepted<
  AccountResult,
  // @ts-expect-error an authenticate result with both arms
  { readonly principal: { readonly userId: "u1" }; readonly deny: MemberDenial }
>;

export type ResolvedAlone = Accepted<
  ProjectResolution,
  { readonly resolved: { readonly scope: "project"; readonly id: "p1" } }
>;

export type BothResolutionArmsFail = Accepted<
  ProjectResolution,
  // @ts-expect-error a scope resolution with both arms
  {
    readonly resolved: { readonly scope: "project"; readonly id: "p1" };
    readonly deny: MemberDenial;
  }
>;

export type EditTaskDecider = DecideHook<EditTaskRequest>;
