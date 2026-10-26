package io.github.jubasse.seampact.webhooks;

/** The scheme names a MAC algorithm this helper does not compute; the IR's algorithm enum is open. */
public final class UnsupportedSignatureAlgorithmException extends IllegalArgumentException {
    private static final long serialVersionUID = 1L;

    public UnsupportedSignatureAlgorithmException(String algorithm) {
        super("The signature algorithm '" + algorithm + "' is not supported; this helper computes '"
            + TemplateSignatureVerifier.SUPPORTED_ALGORITHM + "'. Verify this scheme in your own authenticate hook.");
    }
}
