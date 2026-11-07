package com.example.consumer;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.context.annotation.Conditional;
import org.springframework.core.type.AnnotatedTypeMetadata;

/** Leaves a bean out when the process runs one of [value]'s boot variants, so the boot check refuses to start. */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Conditional(SkippedUnder.Unless.class)
@interface SkippedUnder {
    String[] value();

    final class Unless implements Condition {
        @Override
        public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
            Object variants = metadata.getAnnotationAttributes(SkippedUnder.class.getName()).get("value");
            if (!(variants instanceof String[] names)) return true;

            for (String name : names) {
                if (BootVariant.is(name)) return false;
            }

            return true;
        }
    }
}
