package com.example.optins.api.spring.runtime;

import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.web.method.support.HandlerMethodReturnValueHandler;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter;

/** Places the api's reply handler first in `RequestMappingHandlerAdapter`'s list, before content negotiation. */
public final class ReplyHandlerFirst implements BeanPostProcessor {
    private final ObjectProvider<SeampactBoundary> boundary;

    public ReplyHandlerFirst(ObjectProvider<SeampactBoundary> boundary) {
        this.boundary = boundary;
    }

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        if (!(bean instanceof RequestMappingHandlerAdapter adapter)) return bean;

        List<HandlerMethodReturnValueHandler> handlers = new ArrayList<>();
        handlers.add(new ContractReplyHandler(boundary.getObject()));
        if (adapter.getReturnValueHandlers() != null) handlers.addAll(adapter.getReturnValueHandlers());
        adapter.setReturnValueHandlers(handlers);

        return adapter;
    }
}
