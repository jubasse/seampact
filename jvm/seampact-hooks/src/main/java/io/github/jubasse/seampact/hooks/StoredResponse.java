package io.github.jubasse.seampact.hooks;

import java.util.Arrays;
import java.util.List;
import java.util.Objects;

/**
 * A response kept for replay, already redacted by the generated serializer.
 *
 * @param status the HTTP status
 * @param headers in the order they were sent; a repeated header appears once per value
 * @param body empty when the response has no body
 */
public record StoredResponse(int status, List<Header> headers, byte[] body) {
    public StoredResponse {
        headers = List.copyOf(Objects.requireNonNull(headers, "headers"));
        body = Objects.requireNonNull(body, "body").clone();
    }

    /** A copy, so the stored response stays unchanged. */
    @Override
    public byte[] body() {
        return body.clone();
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof StoredResponse that
                && status == that.status
                && headers.equals(that.headers)
                && Arrays.equals(body, that.body);
    }

    @Override
    public int hashCode() {
        return Objects.hash(status, headers, Arrays.hashCode(body));
    }

    /** The body is never shown; each header shows its name only. */
    @Override
    public String toString() {
        return "StoredResponse[status=" + status + ", headers=" + headers + ", body=" + Redaction.REDACTED + "]";
    }

    /**
     * One header line of a stored response.
     *
     * @param name the header name in lower case
     * @param value the header value
     */
    public record Header(String name, String value) {
        public Header {
            Objects.requireNonNull(name, "name");
            Objects.requireNonNull(value, "value");
        }

        /** A header such as {@code set-cookie} may carry a secret, so the value is never shown. */
        @Override
        public String toString() {
            return "Header[name=" + name + ", value=" + Redaction.REDACTED + "]";
        }
    }
}
