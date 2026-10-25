package com.example.tasks.api.spring.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/** The bounded body read (ADR 0022 "Query and bounded values"): a corrupt compressed body is the client's 400. */
class BodyReaderTest {
    private static final long LIMIT_BYTES = 1024;
    private static final int TRUNCATED_BYTES = 20;

    private static byte[] gzip(String text) throws IOException {
        ByteArrayOutputStream compressed = new ByteArrayOutputStream();
        try (GZIPOutputStream stream = new GZIPOutputStream(compressed)) {
            stream.write(text.getBytes(StandardCharsets.UTF_8));
        }

        return compressed.toByteArray();
    }

    @Test
    void truncatedGzipBodyIsCorrupt() throws IOException {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/v1/channels/c1/tasks/batch");
        request.addHeader("Content-Encoding", "gzip");
        request.setContent(Arrays.copyOf(gzip("{\"taskIds\":[\"t1\",\"t2\",\"t3\"]}"), TRUNCATED_BYTES));

        BodyReader.BodyRefusedException refused = assertThrows(BodyReader.BodyRefusedException.class, () -> BodyReader.read(request, LIMIT_BYTES));

        assertEquals(BodyReader.Refused.CORRUPT, refused.reason());
    }
}
