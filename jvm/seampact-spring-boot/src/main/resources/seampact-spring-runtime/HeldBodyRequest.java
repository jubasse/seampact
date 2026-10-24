package io.github.jubasse.seampact.springboot.runtime;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Enumeration;

/**
 * Replays the body the filter read, decoded and unchanged, to Spring and the app (ADR 0022 "Query and bounded
 * values"); the content coding it was sent with is gone from the headers, since the bytes are decoded.
 */
final class HeldBodyRequest extends HttpServletRequestWrapper {
    private static final String CONTENT_ENCODING = "Content-Encoding";
    private static final String CONTENT_LENGTH = "Content-Length";

    private final byte[] body;

    HeldBodyRequest(HttpServletRequest request, byte[] body) {
        super(request);
        this.body = body;
    }

    @Override
    public ServletInputStream getInputStream() {
        ByteArrayInputStream bytes = new ByteArrayInputStream(body);

        return new ServletInputStream() {
            @Override
            public int read() {
                return bytes.read();
            }

            @Override
            public int read(byte[] buffer, int offset, int length) {
                return bytes.read(buffer, offset, length);
            }

            @Override
            public boolean isFinished() {
                return bytes.available() == 0;
            }

            @Override
            public boolean isReady() {
                return true;
            }

            @Override
            public void setReadListener(ReadListener listener) {
                throw new UnsupportedOperationException("seampact: the body was already read by the boundary; read it as a blocking stream");
            }
        };
    }

    @Override
    public BufferedReader getReader() {
        String encoding = getCharacterEncoding();
        Charset charset = encoding == null ? StandardCharsets.UTF_8 : Charset.forName(encoding);

        return new BufferedReader(new InputStreamReader(new ByteArrayInputStream(body), charset));
    }

    @Override
    public int getContentLength() {
        return body.length;
    }

    @Override
    public long getContentLengthLong() {
        return body.length;
    }

    @Override
    public String getHeader(String name) {
        if (CONTENT_ENCODING.equalsIgnoreCase(name)) return null;
        if (CONTENT_LENGTH.equalsIgnoreCase(name)) return Integer.toString(body.length);

        return super.getHeader(name);
    }

    @Override
    public Enumeration<String> getHeaders(String name) {
        if (CONTENT_ENCODING.equalsIgnoreCase(name)) return Collections.emptyEnumeration();
        if (CONTENT_LENGTH.equalsIgnoreCase(name)) return Collections.enumeration(java.util.List.of(Integer.toString(body.length)));

        return super.getHeaders(name);
    }
}
