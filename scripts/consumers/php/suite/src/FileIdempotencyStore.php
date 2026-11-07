<?php

declare(strict_types=1);

namespace Seampact\ConsumerSuite;

use Seampact\Hooks\IdempotencyBegin;
use Seampact\Hooks\IdempotencyClaim;
use Seampact\Hooks\IdempotencyStore;
use Seampact\Hooks\StoredResponse;

/**
 * The app's idempotency store for the suite: one file beside the suite's control state, since each request of PHP's built-in server
 * starts from nothing; entries are kept for their lifetime.
 */
final class FileIdempotencyStore implements IdempotencyStore
{
    private const MILLISECONDS_PER_SECOND = 1000;

    public function begin(IdempotencyClaim $claim): IdempotencyBegin
    {
        return self::changed(static function (array $entries) use ($claim): array {
            $nowMs = self::nowMs();
            // A running entry expires too, so a request that never settled does not hold its key for the app's life.
            $entries = array_filter($entries, static fn (array $entry): bool => $entry['expiresAtMs'] > $nowMs);

            $existing = $entries[$claim->key] ?? null;
            if ($existing === null) {
                $entries[$claim->key] = ['fingerprint' => $claim->fingerprint, 'expiresAtMs' => $nowMs + $claim->lifetimeMs, 'response' => null];

                return [$entries, new IdempotencyBegin\Started()];
            }
            if ($existing['fingerprint'] !== $claim->fingerprint) {
                return [$entries, new IdempotencyBegin\Mismatch()];
            }
            if ($existing['response'] === null) {
                return [$entries, new IdempotencyBegin\Running()];
            }

            return [$entries, new IdempotencyBegin\Replay(self::storedOf($existing['response']))];
        });
    }

    public function complete(string $key, StoredResponse $response): void
    {
        self::changed(static function (array $entries) use ($key, $response): array {
            if (isset($entries[$key])) {
                $entries[$key]['response'] = [
                    'status' => $response->status,
                    'headers' => array_map(static fn (StoredResponse\Header $header): array => [$header->name, $header->value], $response->headers),
                    'body' => base64_encode($response->body),
                ];
            }

            return [$entries, null];
        });
    }

    public function abandon(string $key): void
    {
        self::changed(static function (array $entries) use ($key): array {
            unset($entries[$key]);

            return [$entries, null];
        });
    }

    /** @param array{status: int, headers: list<array{string, string}>, body: string} $stored */
    private static function storedOf(array $stored): StoredResponse
    {
        $headers = array_map(static fn (array $header): StoredResponse\Header => new StoredResponse\Header($header[0], $header[1]), $stored['headers']);

        return new StoredResponse($stored['status'], $headers, (string) base64_decode($stored['body'], true));
    }

    private static function nowMs(): int
    {
        return (int) (microtime(true) * self::MILLISECONDS_PER_SECOND);
    }

    /**
     * Runs `$change` on the entries under an exclusive lock and writes what it returns.
     *
     * @template T
     * @param \Closure(array<string, array{fingerprint: string, expiresAtMs: int, response: ?array{status: int, headers: list<array{string, string}>, body: string}}>): array{array<string, mixed>, T} $change
     * @return T
     */
    private static function changed(\Closure $change): mixed
    {
        $path = SuiteFiles::idempotencyStorePath();
        $handle = fopen($path, 'c+');
        if ($handle === false || !flock($handle, LOCK_EX)) {
            throw new \RuntimeException("the suite idempotency store {$path} cannot be opened and locked");
        }

        try {
            $contents = stream_get_contents($handle, -1, 0);
            $entries = $contents === false || $contents === '' ? [] : json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
            [$written, $result] = $change(is_array($entries) ? $entries : []);
            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, json_encode($written, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));

            return $result;
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }
}
