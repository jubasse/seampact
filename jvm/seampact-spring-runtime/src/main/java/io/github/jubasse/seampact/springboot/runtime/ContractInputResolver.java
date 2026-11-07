package io.github.jubasse.seampact.springboot.runtime;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.MethodParameter;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/** Hands the input record the interceptor validated to the contract method; it claims the api's input types only. */
public final class ContractInputResolver implements HandlerMethodArgumentResolver {
    private final SeampactBoundary boundary;

    public ContractInputResolver(SeampactBoundary boundary) {
        this.boundary = boundary;
    }

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return boundary.binding().inputTypes().containsValue(parameter.getParameterType());
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer container, NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
        HttpServletRequest request = webRequest.getNativeRequest(HttpServletRequest.class);
        Object input = request == null ? null : boundary.exchangeOf(request).map(exchange -> exchange.input).orElse(null);

        if (input == null || !parameter.getParameterType().isInstance(input)) {
            throw new IllegalStateException("seampact: the input " + parameter.getParameterType().getName()
                    + " was not validated by the boundary for this request");
        }

        return input;
    }
}
