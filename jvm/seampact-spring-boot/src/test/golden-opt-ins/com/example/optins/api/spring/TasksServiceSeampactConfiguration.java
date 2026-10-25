package com.example.optins.api.spring;

import com.example.optins.api.spring.runtime.BootCheck;
import com.example.optins.api.spring.runtime.BoundaryFilter;
import com.example.optins.api.spring.runtime.BoundaryMvcConfigurer;
import com.example.optins.api.spring.runtime.ReplyHandlerFirst;
import com.example.optins.api.spring.runtime.SeampactBoundary;
import jakarta.servlet.DispatcherType;
import org.springframework.beans.factory.ListableBeanFactory;
import org.springframework.beans.factory.ObjectProvider;
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
            SeampactBoundary boundary) {
        FilterRegistrationBean<BoundaryFilter> registration = new FilterRegistrationBean<>(new BoundaryFilter(boundary));
        registration.setOrder(BoundaryFilter.ORDER);
        registration.setDispatcherTypes(DispatcherType.REQUEST, DispatcherType.ASYNC);
        registration.setName("tasksServiceSeampactFilter");
        return registration;
    }

    @Bean
    public WebMvcConfigurer tasksServiceSeampactMvc(SeampactBoundary boundary) {
        return new BoundaryMvcConfigurer(boundary);
    }

    @Bean
    public static BeanPostProcessor tasksServiceSeampactReplyHandlerFirst(
            ObjectProvider<SeampactBoundary> boundary) {
        return new ReplyHandlerFirst(boundary);
    }

    @Bean
    public BootCheck tasksServiceSeampactBootCheck(SeampactBoundary boundary) {
        return new BootCheck(boundary);
    }
}
