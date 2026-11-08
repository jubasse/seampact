package io.github.jubasse.seampact.springboot.runtime;

import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.hooks.OperationRef;
import io.github.jubasse.seampact.hooks.RequestView;
import io.github.jubasse.seampact.hooks.SignedTemplateRequest;
import java.lang.annotation.Annotation;
import java.util.Map;
import java.util.Optional;
import org.springframework.beans.factory.ListableBeanFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The binding of a hand-written `tasks` contract table: its right params types, the input records and success arms a
 * test hands it, no hook and no handler.
 */
final class TasksTestBinding implements ApiBinding {
    private final Map<String, Class<?>> rightParamsTypes;
    private final Map<String, Class<?>> inputTypes;
    private final Map<Class<?>, Integer> successArms;
    private final Map<String, Class<? extends Annotation>> annotations;
    private final Authenticator authenticator;
    private final Map<String, Class<?>> authenticateHooks;
    private final Class<? extends Decider> deciderType;
    private final Class<? extends ScopeResolver> scopeResolverType;

    /** What a test's identity hook answers for the credentials the boundary read. */
    @FunctionalInterface
    interface Authenticator {
        AuthenticateResult<?, Denial> authenticate(String identity, JsonNode credentials, Optional<String> csrfToken);
    }

    TasksTestBinding(Map<String, Class<?>> rightParamsTypes) {
        this(rightParamsTypes, Map.of(), Map.of());
    }

    TasksTestBinding(Map<String, Class<?>> rightParamsTypes, Map<String, Class<?>> inputTypes, Map<Class<?>, Integer> successArms) {
        this(rightParamsTypes, inputTypes, successArms, Map.of(), Map.of(), Decider.class, ScopeResolver.class, (identity, credentials, csrfToken) -> {
            throw new UnsupportedOperationException("the test binding authenticates no one");
        });
    }

    private TasksTestBinding(Map<String, Class<?>> rightParamsTypes, Map<String, Class<?>> inputTypes, Map<Class<?>, Integer> successArms,
            Map<String, Class<? extends Annotation>> annotations, Map<String, Class<?>> authenticateHooks, Class<? extends Decider> deciderType,
            Class<? extends ScopeResolver> scopeResolverType, Authenticator authenticator) {
        this.rightParamsTypes = Map.copyOf(rightParamsTypes);
        this.inputTypes = Map.copyOf(inputTypes);
        this.successArms = Map.copyOf(successArms);
        this.annotations = Map.copyOf(annotations);
        this.authenticateHooks = Map.copyOf(authenticateHooks);
        this.deciderType = deciderType;
        this.scopeResolverType = scopeResolverType;
        this.authenticator = authenticator;
    }

    TasksTestBinding withAnnotations(Map<String, Class<? extends Annotation>> composed) {
        return new TasksTestBinding(rightParamsTypes, inputTypes, successArms, composed, authenticateHooks, deciderType, scopeResolverType, authenticator);
    }

    /** The hook interface each identity's authenticate hook bean implements. */
    TasksTestBinding withAuthenticateHooks(Map<String, Class<?>> hooks) {
        return new TasksTestBinding(rightParamsTypes, inputTypes, successArms, annotations, hooks, deciderType, scopeResolverType, authenticator);
    }

    /** The api's own decider and scope resolver interfaces, as its generated code declares them. */
    TasksTestBinding withHookTypes(Class<? extends Decider> decider, Class<? extends ScopeResolver> scopeResolver) {
        return new TasksTestBinding(rightParamsTypes, inputTypes, successArms, annotations, authenticateHooks, decider, scopeResolver, authenticator);
    }

    TasksTestBinding withAuthenticator(Authenticator hook) {
        return new TasksTestBinding(rightParamsTypes, inputTypes, successArms, annotations, authenticateHooks, deciderType, scopeResolverType, hook);
    }

    @Override
    public Map<String, Class<?>> inputTypes() {
        return inputTypes;
    }

    @Override
    public Map<String, Class<? extends Annotation>> annotations() {
        return annotations;
    }

    @Override
    public Map<Class<?>, Integer> successArms() {
        return successArms;
    }

    @Override
    public Map<Class<?>, String> errorArms() {
        return Map.of();
    }

    @Override
    public Optional<String> contractCode(Throwable exception) {
        return Optional.empty();
    }

    @Override
    public Map<String, Class<?>> authenticateHooks() {
        return authenticateHooks;
    }

    @Override
    public Map<String, Class<?>> rightParamsTypes() {
        return rightParamsTypes;
    }

    @Override
    public Map<String, Class<?>> ruleParamsTypes() {
        return Map.of();
    }

    @Override
    public Class<? extends Decider> deciderType() {
        return deciderType;
    }

    @Override
    public Class<? extends ScopeResolver> scopeResolverType() {
        return scopeResolverType;
    }

    @Override
    public Class<? extends UnexpectedErrorListener> unexpectedErrorListenerType() {
        return UnexpectedErrorListener.class;
    }

    @Override
    public String apiId() {
        return "tasks";
    }

    @Override
    public String generatorVersion() {
        return SeampactRuntimeVersion.VERSION;
    }

    @Override
    public AuthenticateResult<?, Denial> authenticate(String identity, ListableBeanFactory beans, JsonMapper mapper, JsonNode credentials,
            Optional<String> csrfToken, Optional<SignedTemplateRequest> signature, RequestView request, OperationRef operation) {
        return authenticator.authenticate(identity, credentials, csrfToken);
    }
}
