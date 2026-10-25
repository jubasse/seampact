package io.github.jubasse.seampact.webhooks;

/**
 * The lookup returned an empty or null secret (an unset environment variable): anyone can compute a MAC with an empty
 * secret, so the check fails closed. The message names the key id and the position in the list, never a secret.
 */
public final class EmptySignatureSecretException extends IllegalStateException {
    private static final long serialVersionUID = 1L;

    public EmptySignatureSecretException(String keyId, int index) {
        super("The secret at position " + index + " looked up for the key '" + keyId + "' is empty or null, so any "
            + "request could pass. Configure the secret (check the environment variable behind the lookup).");
    }
}
