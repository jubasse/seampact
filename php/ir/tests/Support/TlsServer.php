<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Support;

/**
 * `tls-server.php` started in a child PHP for one test class, with a self-signed certificate for 127.0.0.1 made by
 * ext-openssl, so the release channel is tested over real TLS with its verification on.
 */
final class TlsServer
{
    /** @var resource */
    private $process;

    private function __construct(public readonly string $directory, public readonly string $certificate, public readonly int $port, mixed $process)
    {
        if (!is_resource($process)) {
            throw new \RuntimeException('test: the TLS server did not start.');
        }
        $this->process = $process;
    }

    public static function start(string $tarball): self
    {
        $directory = TemporaryDirectory::create('seampact-tls-');
        $certificate = self::certificate($directory);
        $tarballFile = TemporaryDirectory::write($directory, 'bundle.tgz', $tarball);
        $process = proc_open([PHP_BINARY, __DIR__ . '/tls-server.php', $certificate, $tarballFile], [1 => ['pipe', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
        $port = is_resource($process) ? (int) trim((string) fgets($pipes[1])) : 0;

        if ($port === 0) {
            throw new \RuntimeException('test: the TLS server printed no port.');
        }

        return new self($directory, $certificate, $port, $process);
    }

    public function url(string $path): string
    {
        return "https://127.0.0.1:{$this->port}{$path}";
    }

    public function stop(): void
    {
        proc_terminate($this->process, 9);
        proc_close($this->process);
        TemporaryDirectory::remove($this->directory);
    }

    private static function certificate(string $directory): string
    {
        $configFile = TemporaryDirectory::write(
            $directory,
            'openssl.cnf',
            "[req]\ndistinguished_name = dn\n[dn]\n[san]\nsubjectAltName = IP:127.0.0.1\nbasicConstraints = critical,CA:TRUE\n",
        );
        $options = ['config' => $configFile, 'x509_extensions' => 'san', 'digest_alg' => 'sha256'];
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        if ($key === false) {
            throw new \RuntimeException('test: making the key failed: ' . openssl_error_string());
        }

        // openssl_csr_new takes the key by reference.
        $requestKey = $key;
        $request = openssl_csr_new(['commonName' => '127.0.0.1'], $requestKey, $options);
        $signed = $request instanceof \OpenSSLCertificateSigningRequest ? openssl_csr_sign($request, null, $key, 1, $options) : false;
        $certificatePem = '';
        $keyPem = '';

        if ($signed === false || !openssl_x509_export($signed, $certificatePem) || !openssl_pkey_export($key, $keyPem, null, $options)
            || !is_string($certificatePem) || !is_string($keyPem)) {
            throw new \RuntimeException('test: making the self-signed certificate failed: ' . openssl_error_string());
        }

        return TemporaryDirectory::write($directory, 'server.pem', $certificatePem . $keyPem);
    }
}
