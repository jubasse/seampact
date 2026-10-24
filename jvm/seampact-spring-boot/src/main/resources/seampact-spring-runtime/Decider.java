package io.github.jubasse.seampact.springboot.runtime;

import io.github.jubasse.seampact.hooks.DecideHook;
import java.util.Set;

/**
 * A decide hook bean: it answers the rights and rules [names] lists, or every one the api declares when the set holds
 * [EVERY_NAME]. A name served by a bean of its own wins over the bean of every name; two beans claiming one name
 * stop the boot.
 */
public interface Decider extends DecideHook<RequirementCall, Denial> {
    String EVERY_NAME = "*";

    Set<String> names();
}
