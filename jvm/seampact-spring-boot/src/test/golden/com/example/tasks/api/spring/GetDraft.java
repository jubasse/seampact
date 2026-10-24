package com.example.tasks.api.spring;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

/**
 * Maps a controller method to the contract operation 'getDraft'.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@RequestMapping(
        method = RequestMethod.GET,
        path = "/v1/me/drafts/{p1}"
)
public @interface GetDraft {
    String operationId() default "getDraft";

    String access() default "identity";
}
