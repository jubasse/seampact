#!/bin/sh
# Serves the consumer's contract as a bundle over HTTPS (ADR 0011 "Channels", release asset) with no Node:
# `start <work>` makes a loopback certificate, a trust store of the JDK's authorities plus that certificate
# (`<work>/truststore.p12`, password `changeit`), and starts `serve/Serve.java` on <work>/bundles at port 8443;
# `use <work> <app> <binary> <name>` bundles the app's `path` source with the compiler binary into
# <work>/bundles/<name>.tgz and points the app config at that URL with the printed integrity (`contract-source.sh`).
# The build then fetches the bundle with `-Djavax.net.ssl.trustStore=<work>/truststore.p12` in JAVA_TOOL_OPTIONS.
set -eu

port=8443
password=changeit
here=$(cd "$(dirname "$0")" && pwd)

start() {
  work="$1"
  mkdir -p "$work/bundles"
  keytool -genkeypair -alias serve -keyalg RSA -keysize 2048 -validity 2 -dname CN=localhost \
    -ext SAN=dns:localhost,ip:127.0.0.1 -storetype PKCS12 -keystore "$work/keystore.p12" -storepass "$password"
  keytool -exportcert -alias serve -keystore "$work/keystore.p12" -storepass "$password" -file "$work/serve.cer"
  sh "$here/trust-store.sh" "$work/serve.cer" "$work/truststore.p12"

  java "$here/serve/Serve.java" "$work/bundles" "$port" "$work/keystore.p12" "$password" > "$work/serve.log" 2>&1 &
  for _ in $(seq 1 30); do
    if grep -q '^Serving' "$work/serve.log"; then return 0; fi
    sleep 1
  done
  echo "bundle-over-https.sh: the server did not start; its log:" >&2
  cat "$work/serve.log" >&2
  exit 1
}

use() {
  work="$1"
  app="$2"
  binary="$3"
  name="$4"
  tarball="$work/bundles/$name.tgz"

  integrity=$(cd "$app" && "$binary" bundle --tarball "$tarball" --name "$name" --version 1.0.0 | sed -n 's/^integrity: //p')
  if [ -z "$integrity" ]; then
    echo "bundle-over-https.sh: the binary printed no integrity for $app." >&2
    exit 1
  fi

  sh "$here/contract-source.sh" "$app" \
    "  contract:\n    release: { url: \"https://localhost:$port/$name.tgz\" }\n    integrity: $integrity"
}

command="${1:-}"
case "$command" in
  start) start "$2" ;;
  use) use "$2" "$3" "$4" "$5" ;;
  *)
    echo "usage: bundle-over-https.sh start <work> | use <work> <app> <binary> <name>" >&2
    exit 1
    ;;
esac
