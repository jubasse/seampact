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

    TasksTestBinding(Map<String, Class<?>> rightParamsTypes) {
        this(rightParamsTypes, Map.of(), Map.of());
    }

    TasksTestBinding(Map<String, Class<?>> rightParamsTypes, Map<String, Class<?>> inputTypes, Map<Class<?>, Integer> successArms) {
        this.rightParamsTypes = Map.copyOf(rightParamsTypes);
        this.inputTypes = Map.copyOf(inputTypes);
        this.successArms = Map.copyOf(successArms);
    }

    @Override
    public Map<String, Class<?>> inputTypes() {
        return inputTypes;
    }

    @Override
    public Map<String, Class<? extends Annotation>> annotations() {
        return Map.of();
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
        return Map.of();
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
        return Decider.class;
    }

    @Override
    public Class<? extends ScopeResolver> scopeResolverType() {
        return ScopeResolver.class;
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
        throw new UnsupportedOperationException("the test binding authenticates no one");
    }
}
