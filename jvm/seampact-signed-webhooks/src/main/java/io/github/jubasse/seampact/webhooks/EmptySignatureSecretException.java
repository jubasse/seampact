package io.github.jubasse.seampact.webhooks;

/**
 * The lookup returned an empty or null secret (an unset environment variable): anyone can compute a MAC with an empty
 * secret, so the check fails closed. The message names the key id and the position in the list, never a secret; the
 * key id comes from the request, so it enters the message bounded and without control characters.
 */
public final class EmptySignatureSecretException extends IllegalStateException {
    private static final long serialVersionUID = 1L;
    private static final int KEY_ID_LIMIT = 64;
    private static final String TRUNCATED = "...";

    public EmptySignatureSecretException(String keyId, int index) {
        super("The secret at position " + index + " looked up for the key '" + printable(keyId) + "' is empty or null, "
            + "so any request could pass. Configure the secret (check the environment variable behind the lookup).");
    }

    private static String printable(String keyId) {
        String withoutControls = String.valueOf(keyId).codePoints()
            .filter(codePoint -> !Character.isISOControl(codePoint))
            .collect(StringBuilder::new, StringBuilder::appendCodePoint, StringBuilder::append)
            .toString();
        if (withoutControls.length() <= KEY_ID_LIMIT) return withoutControls;

        return withoutControls.substring(0, KEY_ID_LIMIT) + TRUNCATED;
    }
}
