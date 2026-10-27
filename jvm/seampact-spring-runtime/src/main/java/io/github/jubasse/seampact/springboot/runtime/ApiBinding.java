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
 * What the generated code of one api tells the runtime about its own Java types: the input record and composed
 * annotation of each operation, the arms of each result, the codes of the contract exceptions, the typed call of
 * each identity's authenticate hook, the api's own hook interfaces and the version of the generator that wrote it.
 */
public interface ApiBinding {
    Map<String, Class<?>> inputTypes();

    Map<String, Class<? extends Annotation>> annotations();

    /** The status of each success arm of every result. */
    Map<Class<?>, Integer> successArms();

    /** The code of each error arm of every result. */
    Map<Class<?>, String> errorArms();

    /** The code of a generated contract exception, empty for any other exception. */
    Optional<String> contractCode(Throwable exception);

    /** The authenticate hook interface of each identity the kept operations authenticate with. */
    Map<String, Class<?>> authenticateHooks();

    /** The api's decider interface: the boundary calls the decider beans implementing it, never another api's. */
    Class<? extends Decider> deciderType();

    /** The api's scope resolver interface: the boundary calls the resolver beans implementing it. */
    Class<? extends ScopeResolver> scopeResolverType();

    /** The api's unexpected-error listener interface: the boundary reports to the listener beans implementing it. */
    Class<? extends UnexpectedErrorListener> unexpectedErrorListenerType();

    /** The full version of the generator that wrote this api's code, which the boot check compares first (ADR 0025, G3). */
    String generatorVersion();

    /** Calls [identity]'s hook bean with its typed request, built from the credentials the boundary read. */
    AuthenticateResult<?, Denial> authenticate(
            String identity,
            ListableBeanFactory beans,
            JsonMapper mapper,
            JsonNode credentials,
            Optional<String> csrfToken,
            Optional<SignedTemplateRequest> signature,
            RequestView request,
            OperationRef operation);

    /**
     * The Spring Data `Pageable` of the `springPage` list [operationId], built from its validated [query], its sort keys
     * named by the item's Java members (ADR 0022 "Paging"); only an api with such a list overrides it.
     */
    default Object pageable(String operationId, JsonNode style, JsonNode query) {
        throw new IllegalStateException("seampact: this api has no springPage list, so no Pageable");
    }

    /** The page facts (`items`, `total`) of the Spring Data `Page` a `springPage` list returned; any other body as is. */
    default Object pageFacts(Object body) {
        return body;
    }
}
