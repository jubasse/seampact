package com.example.tasks.api.spring;

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
import org.springframework.core.env.Environment;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers the boundary of the api 'tasks'; import it, or let component scan find it.
 */
@Configuration(
        proxyBeanMethods = false
)
public class TasksSeampactConfiguration {
    @Bean
    public SeampactBoundary tasksSeampactBoundary(ListableBeanFactory beans,
            Environment environment) {
        return new SeampactBoundary(TasksContractTable.json(), new TasksSeampactBinding(), beans, environment);
    }

    @Bean
    public FilterRegistrationBean<BoundaryFilter> tasksSeampactFilter(
            @Qualifier("tasksSeampactBoundary") SeampactBoundary boundary) {
        FilterRegistrationBean<BoundaryFilter> registration = new FilterRegistrationBean<>(new BoundaryFilter(boundary));
        registration.setOrder(BoundaryFilter.ORDER);
        registration.setDispatcherTypes(DispatcherType.REQUEST, DispatcherType.ASYNC);
        registration.setName("tasksSeampactFilter");
        return registration;
    }

    @Bean
    public WebMvcConfigurer tasksSeampactMvc(
            @Qualifier("tasksSeampactBoundary") SeampactBoundary boundary) {
        return new BoundaryMvcConfigurer(boundary);
    }

    @Bean
    public static BeanPostProcessor tasksSeampactReplyHandlerFirst(
            @Qualifier("tasksSeampactBoundary") ObjectProvider<SeampactBoundary> boundary) {
        return new ReplyHandlerFirst(boundary);
    }

    @Bean
    public BootCheck tasksSeampactBootCheck(
            @Qualifier("tasksSeampactBoundary") SeampactBoundary boundary) {
        return new BootCheck(boundary);
    }
}
