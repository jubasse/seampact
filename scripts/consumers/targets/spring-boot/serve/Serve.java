// Serves the files of one directory over HTTPS on the loopback interface, so the consumer's build fetches its contract
// bundle as a release asset (ADR 0011 "Channels") with no Node on the runner.
// Usage: java Serve.java <directory> <port> <PKCS12 keystore> <password>

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;

public final class Serve {
    private static final int OK = 200;
    private static final int NOT_FOUND = 404;
    private static final int METHOD_NOT_ALLOWED = 405;
    private static final int NO_BODY = -1;
    private static final String GET = "GET";

    public static void main(String[] arguments) throws IOException, GeneralSecurityException {
        if (arguments.length != 4) {
            System.err.println("usage: java Serve.java <directory> <port> <PKCS12 keystore> <password>");
            System.exit(2);
        }
        Path root = Path.of(arguments[0]).toAbsolutePath().normalize();
        int port = Integer.parseInt(arguments[1]);
        char[] password = arguments[3].toCharArray();

        HttpsServer server = HttpsServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), 0);
        server.setHttpsConfigurator(new HttpsConfigurator(sslContext(Path.of(arguments[2]), password)));
        server.createContext("/", exchange -> answer(exchange, root));
        server.start();
        System.out.println("Serving " + root + " on https://localhost:" + port + "/");
    }

    private static SSLContext sslContext(Path keystoreFile, char[] password) throws IOException, GeneralSecurityException {
        KeyStore keystore = KeyStore.getInstance("PKCS12");
        try (InputStream input = Files.newInputStream(keystoreFile)) {
            keystore.load(input, password);
        }
        KeyManagerFactory keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        keyManagers.init(keystore, password);

        SSLContext context = SSLContext.getInstance("TLS");
        context.init(keyManagers.getKeyManagers(), null, null);
        return context;
    }

    // A path that leaves the directory, or names no regular file, is a 404.
    private static void answer(HttpExchange exchange, Path root) throws IOException {
        try (exchange) {
            if (!GET.equals(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(METHOD_NOT_ALLOWED, NO_BODY);
                return;
            }

            Path file = root.resolve(exchange.getRequestURI().getPath().substring(1)).normalize();
            if (!file.startsWith(root) || !Files.isRegularFile(file)) {
                exchange.sendResponseHeaders(NOT_FOUND, NO_BODY);
                return;
            }

            exchange.sendResponseHeaders(OK, Files.size(file));
            try (OutputStream body = exchange.getResponseBody()) {
                Files.copy(file, body);
            }
        }
    }
}
