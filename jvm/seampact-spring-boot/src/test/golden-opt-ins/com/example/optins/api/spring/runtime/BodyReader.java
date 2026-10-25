package com.example.optins.api.spring.runtime;

import jakarta.servlet.http.HttpServletRequest;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.zip.GZIPInputStream;
import java.util.zip.InflaterInputStream;

/**
 * The bounded body read of step 1 (ADR 0022 "Query and bounded values"): a declared `Content-Length` above the
 * route's limit is refused before reading, and both the bytes sent and the bytes `gzip` or `deflate` decode to are
 * counted while reading, so neither passes the limit. A body sent with more than one coding is refused.
 */
final class BodyReader {
    private static final int CHUNK_BYTES = 8192;
    private static final String IDENTITY = "identity";
    private static final String GZIP = "gzip";
    private static final String DEFLATE = "deflate";
    private static final String CONTENT_ENCODING_HEADER = "Content-Encoding";

    /** Why a body was refused: too large, a content coding the JDK does not decode, or a corrupt compressed body. */
    enum Refused {
        TOO_LARGE,
        UNSUPPORTED_CODING,
        CORRUPT
    }

    static final class BodyRefusedException extends Exception {
        private static final long serialVersionUID = 1L;

        private final Refused reason;

        BodyRefusedException(Refused reason) {
            super(reason.name(), null, false, false);
            this.reason = reason;
        }

        Refused reason() {
            return reason;
        }
    }

    private BodyReader() {}

    static byte[] read(HttpServletRequest request, long limitBytes) throws IOException, BodyRefusedException {
        if (request.getContentLengthLong() > limitBytes) throw new BodyRefusedException(Refused.TOO_LARGE);

        byte[] sent = readBounded(request.getInputStream(), limitBytes);
        String coding = singleCoding(request);
        if (coding == null || coding.isBlank() || IDENTITY.equalsIgnoreCase(coding.trim())) return sent;

        InputStream decoded = switch (coding.trim().toLowerCase(Locale.ROOT)) {
            case GZIP -> gzipStream(sent);
            case DEFLATE -> new InflaterInputStream(new ByteArrayInputStream(sent));
            default -> throw new BodyRefusedException(Refused.UNSUPPORTED_CODING);
        };

        // The sent bytes are already read whole, so any read failure here is the decoder's: a corrupt or truncated body.
        try (decoded) {
            return readBounded(decoded, limitBytes);
        } catch (IOException corrupt) {
            throw new BodyRefusedException(Refused.CORRUPT);
        }
    }

    // Several `Content-Encoding` lines are stacked codings, which the boundary refuses as the Node targets do; a
    // stacked list on one line falls through to the unsupported coding.
    private static String singleCoding(HttpServletRequest request) throws BodyRefusedException {
        List<String> codings = Collections.list(request.getHeaders(CONTENT_ENCODING_HEADER));
        if (codings.size() > 1) throw new BodyRefusedException(Refused.UNSUPPORTED_CODING);

        return codings.isEmpty() ? null : codings.get(0);
    }

    private static InputStream gzipStream(byte[] sent) throws BodyRefusedException {
        try {
            return new GZIPInputStream(new ByteArrayInputStream(sent));
        } catch (IOException corrupt) {
            throw new BodyRefusedException(Refused.CORRUPT);
        }
    }

    private static byte[] readBounded(InputStream input, long limitBytes) throws IOException, BodyRefusedException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] chunk = new byte[CHUNK_BYTES];
        long total = 0;

        for (int read = input.read(chunk); read != -1; read = input.read(chunk)) {
            total += read;
            if (total > limitBytes) throw new BodyRefusedException(Refused.TOO_LARGE);
            bytes.write(chunk, 0, read);
        }

        return bytes.toByteArray();
    }
}
