package com.example.tasks.api.spring.runtime;

import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.hooks.OperationRef;
import io.github.jubasse.seampact.hooks.RequestView;
import java.lang.annotation.Annotation;
import java.util.Map;
import java.util.Optional;
import org.springframework.beans.factory.ListableBeanFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * What the generated code of one api tells the runtime about its own Java types: the input record and composed
 * annotation of each operation, the arms of each result, the codes of the contract exceptions, and the typed call of
 * each identity's authenticate hook.
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

    /** Calls [identity]'s hook bean with its typed request, built from the credentials the boundary read. */
    AuthenticateResult<?, Denial> authenticate(
            String identity,
            ListableBeanFactory beans,
            JsonMapper mapper,
            JsonNode credentials,
            Optional<String> csrfToken,
            RequestView request,
            OperationRef operation);
}
