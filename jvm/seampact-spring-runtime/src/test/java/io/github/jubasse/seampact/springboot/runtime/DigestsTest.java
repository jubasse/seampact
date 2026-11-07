package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.MissingNode;

/** The canonical text every target digests: what `JSON.stringify` writes with object members sorted by name. */
class DigestsTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

    @Test
    void hashesKnownTextsToTheirStandardSha256() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", Digests.hexOf("abc".getBytes(StandardCharsets.UTF_8)));
        assertEquals("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", Digests.hexOf(List.of()));
        assertEquals("135f17a475a61afdeeaf3759ad2e45ad1c7abb192395abe47e41fc8e395dc1a9", Digests.hexOf(List.of(NODES.stringNode("a"), NODES.numberNode(1))));
    }

    @Test
    void writesTheBase64UrlFormWithoutPadding() {
        assertEquals("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0", Digests.base64UrlOf("abc".getBytes(StandardCharsets.UTF_8)));
        assertEquals("E18XpHWmGv3urzdZrS5FrRx6uxkjlavkfkH8jjldwak", Digests.base64UrlOf(List.of(NODES.stringNode("a"), NODES.numberNode(1))));
    }

    @Test
    void sortsObjectMembersByNameAtEveryDepth() {
        assertEquals("{\"a\":2,\"b\":{\"x\":1,\"y\":[{\"m\":1,\"n\":2}]}}",
                canonical("{\"b\": {\"y\": [{\"n\": 2, \"m\": 1}], \"x\": 1}, \"a\": 2}"));
    }

    @Test
    void sortsMembersByUtf16CodeUnitsNotByCodePoints() {
        // U+1F600 (units 0xD83D 0xDE00) sorts before U+FF5E (unit 0xFF5E) in code units, after it in code points.
        assertEquals("{\"\uD83D\uDE00\":1,\"\uFF5E\":2}", canonical("{\"\uFF5E\": 2, \"\uD83D\uDE00\": 1}"));
    }

    @Test
    void writesArrayIndexNamesFirstInNumericOrderLikeAJavaScriptObject() {
        assertEquals("{\"2\":3,\"10\":2,\"01\":5,\"4294967295\":6,\"a\":0,\"b\":1}",
                canonical("{\"b\": 1, \"10\": 2, \"2\": 3, \"a\": 0, \"01\": 5, \"4294967295\": 6}"));
    }

    @Test
    void writesNumbersAsJavaScriptPrintsADouble() {
        assertEquals("[0,100,1.5,-2,0.000001,1e-7,123456789012345680000,1e+21,-1e+21,1.5e+300,1.2345e-10]",
                canonical("[0, 100.0, 1.50, -2, 0.000001, 0.0000001, 123456789012345680000, 1e21, -1e21, 1.5e300, 1.2345e-10]"));
    }

    @Test
    void writesANegativeZeroAndAnExactIntegerAsPlainDigits() {
        assertEquals("0", Digests.jsNumber(new BigDecimal("-0.0")));
        assertEquals("9007199254740992", Digests.jsNumber(new BigDecimal("9007199254740993")));
    }

    @Test
    void writesNullMissingAndBooleansAsJsonDoes() {
        assertEquals("null", Digests.canonical(NODES.nullNode()));
        assertEquals("null", Digests.canonical(MissingNode.getInstance()));
        assertEquals("[true,false,null]", canonical("[true, false, null]"));
    }

    @Test
    void escapesStringsLikeJsonStringify() {
        assertEquals("\"a\\\"b\\\\c\\n\\r\\t\\b\\f\\u0001\\u001f\u007f<>&\u2028\"",
                Digests.canonical(NODES.stringNode("a\"b\\c\n\r\t\b\f\u0001\u001f\u007f<>&\u2028")));
    }

    @Test
    void writesALoneSurrogateAsALowercaseEscapeAndAPairAsIs() {
        assertEquals("\"\\ud800\"", Digests.canonical(NODES.stringNode("\uD800")));
        assertEquals("\"\\udc00x\"", Digests.canonical(NODES.stringNode("\uDC00x")));
        assertEquals("\"a\\ud83d\"", Digests.canonical(NODES.stringNode("a\uD83D")));
        assertEquals("\"\uD83D\uDE00\"", Digests.canonical(NODES.stringNode("\uD83D\uDE00")));
    }

    @Test
    void digestsTheUtf8OfNonAsciiTextAndTheSameHexWhateverTheMemberOrder() {
        JsonNode first = MAPPER.readTree("{\"name\": \"caf\u00e9\", \"id\": 1}");
        JsonNode second = MAPPER.readTree("{\"id\": 1, \"name\": \"caf\u00e9\"}");

        assertEquals(Digests.hexOf(List.of(first)), Digests.hexOf(List.of(second)));
        assertEquals(Digests.hexOf("[{\"id\":1,\"name\":\"caf\u00e9\"}]".getBytes(StandardCharsets.UTF_8)), Digests.hexOf(List.of(first)));
    }

    private static String canonical(String json) {
        return Digests.canonical(MAPPER.readTree(json));
    }
}
