#!/bin/sh
# Serves the consumer's contract as a bundle over HTTPS (ADR 0011 "Channels", release asset) with no Node:
# `start <work>` makes a loopback certificate, a trust store of the JDK's authorities plus that certificate
# (`<work>/truststore.p12`, password `changeit`), and starts `serve/Serve.java` on <work>/bundles at port 8443;
# `use <work> <app> <binary> <name>` bundles the app's `path` source with the compiler binary into
# <work>/bundles/<name>.tgz, points the app config at that URL with the printed integrity, and removes the sources.
# The build then fetches the bundle with `-Djavax.net.ssl.trustStore=<work>/truststore.p12` in JAVA_TOOL_OPTIONS.
set -eu

port=8443
password=changeit
here=$(cd "$(dirname "$0")" && pwd)
path_source='  contract: { path: contract }'

start() {
  work="$1"
  mkdir -p "$work/bundles"
  keytool -genkeypair -alias serve -keyalg RSA -keysize 2048 -validity 2 -dname CN=localhost \
    -ext SAN=dns:localhost,ip:127.0.0.1 -storetype PKCS12 -keystore "$work/keystore.p12" -storepass "$password"
  keytool -exportcert -alias serve -keystore "$work/keystore.p12" -storepass "$password" -file "$work/serve.cer"
  java_home="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")}"
  keytool -importkeystore -srckeystore "$java_home/lib/security/cacerts" -srcstorepass "$password" \
    -destkeystore "$work/truststore.p12" -deststoretype PKCS12 -deststorepass "$password" -noprompt
  keytool -importcert -alias serve -file "$work/serve.cer" -keystore "$work/truststore.p12" -storepass "$password" -noprompt

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
  if [ -z "$integrity" ] || ! grep -qxF "$path_source" "$app/seampact.config.yaml"; then
    echo "bundle-over-https.sh: no integrity printed, or $app/seampact.config.yaml has no line '$path_source'." >&2
    exit 1
  fi

  release="  contract:\n    release: { url: \"https://localhost:$port/$name.tgz\" }\n    integrity: $integrity"
  awk -v source="$path_source" -v release="$release" '$0 == source { print release; next } { print }' \
    "$app/seampact.config.yaml" > "$app/seampact.config.yaml.new"
  mv "$app/seampact.config.yaml.new" "$app/seampact.config.yaml"
  rm -rf "$app/contract"
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
