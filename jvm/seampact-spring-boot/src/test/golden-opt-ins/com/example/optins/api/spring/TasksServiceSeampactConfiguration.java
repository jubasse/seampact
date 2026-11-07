package com.example.optins.api.spring;

import io.github.jubasse.seampact.springboot.runtime.BootCheck;
import io.github.jubasse.seampact.springboot.runtime.BoundaryFilter;
import io.github.jubasse.seampact.springboot.runtime.BoundaryMvcConfigurer;
import io.github.jubasse.seampact.springboot.runtime.ReplyHandlerFirst;
import io.github.jubasse.seampact.springboot.runtime.SeampactBoundary;
import jakarta.servlet.DispatcherType;
import org.springframework.beans.factory.ListableBeanFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.Environment;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers the boundary of the api 'tasksService'; import it, or let component scan find it.
 */
@Configuration(
        proxyBeanMethods = false
)
@Import(TasksServiceSecurityConfiguration.class)
public class TasksServiceSeampactConfiguration {
    @Bean
    public SeampactBoundary tasksServiceSeampactBoundary(ListableBeanFactory beans,
            Environment environment) {
        return new SeampactBoundary(TasksServiceContractTable.json(), new TasksServiceSeampactBinding(), beans, environment);
    }

    @Bean
    public FilterRegistrationBean<BoundaryFilter> tasksServiceSeampactFilter(
            @Qualifier("tasksServiceSeampactBoundary") SeampactBoundary boundary) {
        FilterRegistrationBean<BoundaryFilter> registration = new FilterRegistrationBean<>(new BoundaryFilter(boundary));
        registration.setOrder(BoundaryFilter.ORDER);
        registration.setDispatcherTypes(DispatcherType.REQUEST, DispatcherType.ASYNC);
        registration.setName("tasksServiceSeampactFilter");
        return registration;
    }

    @Bean
    public WebMvcConfigurer tasksServiceSeampactMvc(
            @Qualifier("tasksServiceSeampactBoundary") SeampactBoundary boundary) {
        return new BoundaryMvcConfigurer(boundary);
    }

    @Bean
    public static BeanPostProcessor tasksServiceSeampactReplyHandlerFirst(
            @Qualifier("tasksServiceSeampactBoundary") ObjectProvider<SeampactBoundary> boundary) {
        return new ReplyHandlerFirst(boundary);
    }

    @Bean
    public BootCheck tasksServiceSeampactBootCheck(
            @Qualifier("tasksServiceSeampactBoundary") SeampactBoundary boundary) {
        return new BootCheck(boundary);
    }
}
