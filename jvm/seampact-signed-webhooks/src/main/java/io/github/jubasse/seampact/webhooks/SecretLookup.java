package io.github.jubasse.seampact.webhooks;

import java.util.List;

/** The secrets currently valid for a key id: one, or several during a rotation. The verifier never keeps them. */
@FunctionalInterface
public interface SecretLookup {
    /** The secret bytes, none when the key id is unknown. */
    List<byte[]> secretsFor(String keyId);
}
