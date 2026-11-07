package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** A normalised pattern runs on java.util.regex as an ECMA-262 search (ADR 0003 section 9). */
class PatternSyntaxTest {
    private static boolean finds(String normalized, String text) {
        return Pattern.compile(StructuralValidator.javaSyntaxOf(normalized)).matcher(text).find();
    }

    @Test
    void dollarIsTheEndOfTheStringNeverBeforeAFinalNewline() {
        assertTrue(finds("^[a-z]+$", "abc"));
        assertFalse(finds("^[a-z]+$", "abc\n"));
    }

    @Test
    void anUnanchoredPatternMatchesAnywhere() {
        assertTrue(finds("[0-9]", "ab1"));
    }

    @Test
    void escapedAnchorsAndClassCaretsStayLiteral() {
        assertTrue(finds("\\$[\\^a]", "$^"));
        assertFalse(finds("[^a]", "a"));
    }

    @Test
    void anAstralEscapeMatchesOneCodePoint() {
        assertTrue(finds("^\\u{1F600}$", new String(Character.toChars(0x1F600))));
    }
}
