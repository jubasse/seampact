package io.github.jubasse.seampact.hooks;

import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * What the decide hook receives for one right or rule; the generated request record narrows each member.
 *
 * @param <Codes> the codes a denial may name, bound here so a decider's {@link Decision} is checked against them
 * @param <Params> the params declared at the use site
 * @param <Principal> the identity's principal
 * @param <RequirementExtensions> the right's or rule's extension values
 * @param <OperationExtensions> the operation's extension values
 */
public interface RequirementRequest<
        Codes extends ErrorCodeWithParams, Params, Principal, RequirementExtensions, OperationExtensions> {
    /** Whether the requirement is a right or a rule. */
    RequirementKind kind();

    /** The right's or rule's name. */
    String name();

    /** The params declared at the use site. */
    Optional<Params> params();

    /** Null for an anonymous caller on a public or optional-auth route. */
    Principal principal();

    /** Present when the right has a subject. */
    Optional<? extends SubjectRef<?, ?>> subject();

    /** The resolved scopes, outermost first. */
    List<? extends ResolvedScope<?, ?>> scopes();

    /** The rule's proof, when the rule declares one. */
    Optional<?> proof();

    /** Present for a throttle rule. */
    Optional<ThrottleBucket> bucket();

    /** Why the boundary asks. */
    Purpose purpose();

    /** The operation the hook is called for. */
    OperationRef operation();

    /** A read-only view of the request. */
    RequestView request();

    /** The extension values of the right or rule and of the operation. */
    Extensions<RequirementExtensions, OperationExtensions> extensions();

    /**
     * The extension values a decider receives.
     *
     * @param requirement the right's or rule's extension values
     * @param operation the operation's extension values
     * @param <RequirementExtensions> the right's or rule's extension values
     * @param <OperationExtensions> the operation's extension values
     */
    record Extensions<RequirementExtensions, OperationExtensions>(
            RequirementExtensions requirement, OperationExtensions operation) {
        public Extensions {
            Objects.requireNonNull(requirement, "requirement");
            Objects.requireNonNull(operation, "operation");
        }
    }
}
