package com.example.optins.api.spring.runtime;

/** One `schemaInvalid` issue: the input part, the JSON pointer inside it and the contract's rule name. */
public record InputIssue(String in, String pointer, String rule) {
    /** The pointer of [name] below [parent], escaped as RFC 6901 says. */
    static String below(String parent, String name) {
        return parent + "/" + name.replace("~", "~0").replace("/", "~1");
    }
}
