package com.example.consumer;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.context.annotation.Conditional;
import org.springframework.core.type.AnnotatedTypeMetadata;

/** Registers a bean only when the process runs one of [value]'s boot variants. */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Conditional(ServedUnder.When.class)
@interface ServedUnder {
    String[] value();

    final class When implements Condition {
        @Override
        public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
            Object variants = metadata.getAnnotationAttributes(ServedUnder.class.getName()).get("value");
            if (!(variants instanceof String[] names)) return false;

            for (String name : names) {
                if (BootVariant.is(name)) return true;
            }

            return false;
        }
    }
}
