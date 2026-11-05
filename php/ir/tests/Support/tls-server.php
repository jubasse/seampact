<?php

// A one-process HTTPS server for the release channel tests: `php tls-server.php <certificate pem> <tarball>
// <assets directory>`. It prints its port, then answers each request by path: the tarball, a file of the assets
// directory, redirects, an error, a slow answer, a body cut before its length, headers that trickle in.

declare(strict_types=1);

$arguments = is_array($_SERVER['argv'] ?? null) ? $_SERVER['argv'] : [];
$certificate = is_string($arguments[1] ?? null) ? $arguments[1] : '';
$tarball = is_string($arguments[2] ?? null) ? (string) file_get_contents($arguments[2]) : '';
$assetsDirectory = is_string($arguments[3] ?? null) ? $arguments[3] : '';
$context = stream_context_create(['ssl' => ['local_cert' => $certificate, 'allow_self_signed' => true, 'verify_peer' => false]]);
$server = stream_socket_server('tls://127.0.0.1:0', $errorCode, $errorText, STREAM_SERVER_BIND | STREAM_SERVER_LISTEN, $context);

if ($server === false) {
    fwrite(STDERR, "tls-server: {$errorText}\n");
    exit(1);
}

$name = (string) stream_socket_get_name($server, false);
echo substr($name, strrpos($name, ':') + 1), "\n";
fflush(STDOUT);

// The test class stops the server long before this many requests.
for ($served = 0; $served < 10_000; $served++) {
    $client = @stream_socket_accept($server, 30);
    if ($client === false) {
        continue;
    }

    $requestLine = (string) fgets($client);
    while (($line = fgets($client)) !== false && trim($line) !== '') {
    }

    $path = explode(' ', $requestLine)[1] ?? '/';
    if (str_starts_with($path, '/truncated/')) {
        @fwrite($client, "HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n0123456789");
        @fclose($client);
        continue;
    }

    if (str_starts_with($path, '/trickle-headers/')) {
        trickleHeaders($client);
        continue;
    }

    $asset = str_starts_with($path, '/assets/') ? $assetsDirectory . '/' . basename($path) : null;
    if ($asset !== null && is_file($asset)) {
        $path = '/asset';
    }

    [$status, $headers, $body] = match ($path) {
        '/asset' => ['200 OK', [], (string) file_get_contents((string) $asset)],
        '/bundle.tgz' => ['200 OK', [], $tarball],
        '/hop' => ['302 Found', ['Location: /bundle.tgz'], ''],
        '/to-http' => ['302 Found', ['Location: http://127.0.0.1/bundle.tgz'], ''],
        '/loop' => ['302 Found', ['Location: /loop'], ''],
        '/slow' => (static function () use ($tarball): array {
            sleep(3);

            return ['200 OK', [], $tarball];
        })(),
        default => ['404 Not Found', [], 'missing'],
    };

    $head = "HTTP/1.1 {$status}\r\nContent-Length: " . strlen($body) . "\r\nConnection: close\r\n" . implode('', array_map(static fn (string $header): string => "{$header}\r\n", $headers));
    @fwrite($client, "{$head}\r\n{$body}");
    @fclose($client);
}

// A byte of one header every tenth of a second for three seconds, so only a deadline over the whole request stops it.
function trickleHeaders(mixed $client): void
{
    if (!is_resource($client)) {
        return;
    }

    $written = @fwrite($client, "HTTP/1.1 200 OK\r\nX-Trickle: ");
    for ($sent = 0; $sent < 30 && $written !== false; $sent++) {
        usleep(100_000);
        $written = @fwrite($client, 'a');
    }

    @fclose($client);
}
