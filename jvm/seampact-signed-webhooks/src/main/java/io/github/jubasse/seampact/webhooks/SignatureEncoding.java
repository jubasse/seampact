package io.github.jubasse.seampact.webhooks;

/** How a candidate signature is written in the header (ADR 0013). */
public enum SignatureEncoding {
    HEX("hex"),
    BASE64("base64");

    private final String irName;

    SignatureEncoding(String irName) {
        this.irName = irName;
    }

    /** The encoding the IR names; another name is refused with the names this helper reads. */
    public static SignatureEncoding fromIrName(String irName) {
        for (SignatureEncoding encoding : values()) {
            if (encoding.irName.equals(irName)) return encoding;
        }

        throw new IllegalArgumentException("Unknown signature encoding '" + irName + "'; this helper reads 'hex' and 'base64'.");
    }
}
