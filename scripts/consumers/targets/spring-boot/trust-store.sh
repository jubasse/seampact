#!/bin/sh
# Writes a PKCS12 trust store of the JDK's certificate authorities plus one certificate, password `changeit`:
# `trust-store.sh <certificate file> <trust store>`. A build run with
# `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStore=<trust store> -Djavax.net.ssl.trustStorePassword=changeit` then
# fetches from a loopback HTTPS server and still from Maven Central.
set -eu

certificate="$1"
trust_store="$2"
password=changeit
java_home="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")}"

# keytool lists every certificate it copies; its output is shown only when it fails.
keytool_quietly() {
  if ! output=$(keytool "$@" 2>&1); then
    echo "$output" >&2
    exit 1
  fi
}

rm -f "$trust_store"
keytool_quietly -importkeystore -srckeystore "$java_home/lib/security/cacerts" -srcstorepass "$password" \
  -destkeystore "$trust_store" -deststoretype PKCS12 -deststorepass "$password" -noprompt
keytool_quietly -importcert -alias seampact-loopback -file "$certificate" -keystore "$trust_store" -storepass "$password" -noprompt
