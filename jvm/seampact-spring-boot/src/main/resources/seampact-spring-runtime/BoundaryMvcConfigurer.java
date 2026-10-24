package io.github.jubasse.seampact.springboot.runtime;

import java.util.List;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.HandlerExceptionResolver;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Registers the interceptor, the argument resolver and the first exception resolver of one api. */
public final class BoundaryMvcConfigurer implements WebMvcConfigurer {
    private final SeampactBoundary boundary;

    public BoundaryMvcConfigurer(SeampactBoundary boundary) {
        this.boundary = boundary;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new BoundaryInterceptor(boundary));
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new ContractInputResolver(boundary));
    }

    @Override
    public void extendHandlerExceptionResolvers(List<HandlerExceptionResolver> resolvers) {
        resolvers.add(0, new ContractExceptionResolver(boundary));
    }
}
