package com.example.tasks.api.spring;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

/**
 * Maps a controller method to the contract operation 'updatePreferences'.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@RequestMapping(
        method = RequestMethod.PATCH,
        path = "/v1/me/preferences"
)
public @interface UpdatePreferences {
    String operationId() default "updatePreferences";

    String access() default "identity";
}
