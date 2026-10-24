package io.github.jubasse.seampact.springboot.runtime;

import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

/**
 * The checking wrapper of a contract route's response (ADR 0022 "The outgoing response check"): every writer's
 * status and bytes are held until the boundary's verdict, so a violation is replaced before anything reaches the
 * client. `sendError` is recorded, never passed to the container's error page. Under `frameworkEtag: strip` an
 * `ETag` the boundary did not set is dropped.
 */
final class CheckingResponse extends HttpServletResponseWrapper {
    private static final String ETAG = "ETag";
    private static final String CONTENT_LENGTH = "Content-Length";

    private final ByteArrayOutputStream held = new ByteArrayOutputStream();
    private final boolean stripFrameworkEtag;
    private int status = SC_OK;
    private boolean errorSent;
    private ServletOutputStream stream;
    private PrintWriter writer;

    CheckingResponse(HttpServletResponse response, boolean stripFrameworkEtag) {
        super(response);
        this.stripFrameworkEtag = stripFrameworkEtag;
    }

    int heldStatus() {
        return status;
    }

    boolean errorSent() {
        return errorSent;
    }

    byte[] heldBody() {
        if (writer != null) writer.flush();

        return held.toByteArray();
    }

    /** Clears what the writers wrote, before the boundary writes its own reply in place of it. */
    void discard() {
        held.reset();
        errorSent = false;
        status = SC_OK;
        getResponse().reset();
    }

    /** Writes the held reply to the client. */
    void release(byte[] body) throws IOException {
        HttpServletResponse response = (HttpServletResponse) getResponse();
        response.setStatus(status);
        response.setContentLength(body.length);
        response.getOutputStream().write(body);
        response.flushBuffer();
    }

    @Override
    public void setStatus(int code) {
        status = code;
    }

    @Override
    public int getStatus() {
        return status;
    }

    @Override
    public void sendError(int code) {
        status = code;
        errorSent = true;
    }

    @Override
    public void sendError(int code, String message) {
        sendError(code);
    }

    @Override
    public void sendRedirect(String location) {
        status = SC_FOUND;
        setHeader("Location", location);
    }

    @Override
    public void setHeader(String name, String value) {
        if (isHeldHeader(name)) return;
        super.setHeader(name, value);
    }

    @Override
    public void addHeader(String name, String value) {
        if (isHeldHeader(name)) return;
        super.addHeader(name, value);
    }

    /** Sets a header the boundary itself writes, such as its own ETag. */
    void setBoundaryHeader(String name, String value) {
        super.setHeader(name, value);
    }

    private boolean isHeldHeader(String name) {
        return CONTENT_LENGTH.equalsIgnoreCase(name) || (stripFrameworkEtag && ETAG.equalsIgnoreCase(name));
    }

    @Override
    public void setContentLength(int length) {}

    @Override
    public void setContentLengthLong(long length) {}

    @Override
    public boolean isCommitted() {
        return false;
    }

    @Override
    public void flushBuffer() {}

    @Override
    public void reset() {
        discard();
    }

    @Override
    public void resetBuffer() {
        held.reset();
    }

    @Override
    public ServletOutputStream getOutputStream() {
        if (stream == null) stream = new HeldStream();

        return stream;
    }

    @Override
    public PrintWriter getWriter() {
        if (writer == null) {
            String encoding = getCharacterEncoding();
            Charset charset = encoding == null ? StandardCharsets.UTF_8 : Charset.forName(encoding);
            writer = new PrintWriter(new OutputStreamWriter(held, charset));
        }

        return writer;
    }

    private final class HeldStream extends ServletOutputStream {
        @Override
        public void write(int value) {
            held.write(value);
        }

        @Override
        public void write(byte[] bytes, int offset, int length) {
            held.write(bytes, offset, length);
        }

        @Override
        public boolean isReady() {
            return true;
        }

        @Override
        public void setWriteListener(WriteListener listener) {
            throw new UnsupportedOperationException("seampact: a contract route's response is held for its check; non-blocking writes wait for the streamed bodies");
        }
    }
}
