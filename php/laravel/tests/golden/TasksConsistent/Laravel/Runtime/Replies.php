<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Writes every contract reply: a declared success from a generated result, and a contract error in the api's format,
 * serialized by the boundary's own `json_encode` call, never an API Resource or the app's response macros.
 */
final class Replies
{
    public const JSON_MEDIA = 'application/json';
    public const JSON_FLAGS = JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION;
    public const CACHE_CONTROL_HEADER = 'Cache-Control';
    public const NO_STORE_DIRECTIVE = 'no-store';
    private const SECONDS_UNIT = 's';
    private const MILLISECONDS_PER_SECOND = 1000;
    private const NULL_ABSENT = 'null';
    private const PAYLOAD_SLOT = 'payload';
    private const NO_CONTENT = 204;
    private const PAGE_SHAPE = 'page';

    private function __construct()
    {
    }

    /** The error reply of `$code` in the operation's format, or the api's format when no operation matched. */
    public static function error(ApiContract $contract, ?string $operationId, string $code, ?\stdClass $params = null): Response
    {
        $format = $contract->format($operationId);
        $catalog = $contract->catalogEntry($code);
        $slots = [
            'code' => $code,
            'status' => $contract->statusOf($code),
            'nature' => Ir::string($catalog, 'nature'),
        ];
        $title = Ir::string($catalog, 'title');
        if ($title !== null) {
            $slots['title'] = $title;
        }
        if ($params !== null) {
            $slots['params'] = $params;
        }

        $error = Ir::map($format, 'error');
        $body = Templates::render($error['body'] ?? null, $slots, Ir::string($format, 'absent') === self::NULL_ABSENT);

        $reply = new Response(
            json_encode($body->present ? $body->value : new \stdClass(), self::JSON_FLAGS),
            $contract->statusOf($code),
            ['Content-Type' => Ir::string($error, 'media') ?? self::JSON_MEDIA],
        );
        if ($catalog['noStore'] ?? false) {
            $reply->headers->set(self::CACHE_CONTROL_HEADER, self::NO_STORE_DIRECTIVE);
        }
        if ($operationId !== null) {
            self::writeRetryHeader($reply, $contract->errorDeclaration($operationId, $code), $params);
        }

        return $reply;
    }

    /**
     * The delay param of a refusal, in integer milliseconds, written in its retry header's unit (`Retry-After`).
     *
     * @param array<array-key, mixed> $declared
     */
    private static function writeRetryHeader(Response $reply, array $declared, ?\stdClass $params): void
    {
        $retryHeader = Ir::map($declared, 'retryHeader');
        $name = Ir::string($retryHeader, 'name');
        $delayMs = $params->{Ir::string($retryHeader, 'param') ?? ''} ?? null;
        if ($name === null || !is_int($delayMs) && !is_float($delayMs)) {
            return;
        }

        $value = Ir::string($retryHeader, 'unit') === self::SECONDS_UNIT ? (int) ceil($delayMs / self::MILLISECONDS_PER_SECOND) : (int) $delayMs;
        $reply->headers->set($name, (string) $value);
    }

    /**
     * The params a role's template renders from `$slots` (`issues`, `limitBytes`), null when the code binds none.
     *
     * @param array<string, mixed> $slots
     */
    public static function roleParams(ApiContract $contract, string $operationId, string $code, string $role, array $slots): ?\stdClass
    {
        $template = $contract->roleParams($operationId, $code, $role);
        if ($template === null) {
            return null;
        }
        $rendered = Templates::render($template, $slots, false);

        return $rendered->value instanceof \stdClass ? $rendered->value : null;
    }

    /** The reply of a generated result: a declared success, or one of the operation's declared errors. */
    public static function result(Request $request, string $api, object $result): Response
    {
        $state = BoundaryState::required($request, $api);
        $contract = $state->contract;
        $answers = $contract->resultOf($result);
        if ($answers === null || $answers[0] !== $state->operationId) {
            throw new BoundaryFailure(new \LogicException('seampact: the handler of operation ' . var_export($state->operationId, true) . ' returned ' . $result::class . ', which is not one of its results.'));
        }

        [$operationId, $status] = $answers;
        if ($status === ApiContract::ERRORS_RESULT) {
            return $state->author(self::errorResult($contract, $operationId, $result));
        }

        $declared = self::declaredResponse($contract, $operationId, $status);
        if (Ir::string($declared, 'shape') === 'empty' || $status === self::NO_CONTENT) {
            return $state->author(new Response('', $status));
        }

        $media = Ir::string($declared, 'media') ?? Ir::string($contract->format($operationId), 'media') ?? self::JSON_MEDIA;
        if (Ir::string($declared, 'shape') === self::PAGE_SHAPE) {
            return $state->author(CacheHeaders::written($request, $state, self::page($request, $state, $declared, self::member($result, 'body'), $status, $media)));
        }

        $body = WireCodec::encodeBody($contract, $declared, self::member($result, 'body'));
        $body = self::enveloped($request, $state, Ir::string($declared, 'shape') ?? '', FieldRights::output($state, $declared, $body), $status);

        $reply = new Response(json_encode($body, self::JSON_FLAGS), $status, ['Content-Type' => $media]);

        return $state->author(CacheHeaders::written($request, $state, $reply));
    }

    private static function enveloped(Request $request, BoundaryState $state, string $shape, mixed $payload, int $status): mixed
    {
        return self::successBody($state->contract->format($state->operationId), $shape, $payload, $status, RawTarget::path($request));
    }

    /**
     * The success body in its format's envelope (ADR 0002 section 13): `{ data: $payload }` under `pack:laravel`, the
     * payload itself under a bare format, `null` included. Generation refuses an envelope that does not write
     * `$payload` under named members, so an object template always renders.
     *
     * @param array<array-key, mixed> $format
     */
    public static function successBody(array $format, string $shape, mixed $payload, int $status, string $path): mixed
    {
        $template = Ir::map(Ir::map($format, 'success'), $shape)['body'] ?? null;
        if ($template === null || self::isBarePayload($template)) {
            return $payload;
        }

        $slots = [self::PAYLOAD_SLOT => $payload, 'status' => $status, 'path' => $path];
        $rendered = Templates::render($template, $slots, Ir::string($format, 'absent') === self::NULL_ABSENT);
        if (!$rendered->present) {
            throw new \LogicException("seampact: the format's '{$shape}' success envelope rendered nothing; regenerate the api, whose generation refuses an envelope that does not write \$payload under named members.");
        }

        return $rendered->value;
    }

    private static function isBarePayload(mixed $template): bool
    {
        return Ir::string($template, 'kind') === 'slot' && Ir::string($template, 'slot') === self::PAYLOAD_SLOT && Ir::list($template, 'path') === [];
    }

    /**
     * A paged list's reply: the page's items encoded and projected, then the body, headers and links of its style.
     *
     * @param array<array-key, mixed> $declared
     */
    private static function page(Request $request, BoundaryState $state, array $declared, mixed $page, int $status, string $media): Response
    {
        if (!is_object($page)) {
            throw new \LogicException("seampact: the handler of operation '{$state->operationId}' answered its page with " . get_debug_type($page) . ', not its generated page.');
        }

        $facts = $state->pageReader?->factsOf($page);
        if ($facts === null) {
            $facts = [];
            foreach (get_object_vars($page) as $name => $value) {
                $facts[(string) $name] = $value;
            }
        }
        $items = FieldRights::output($state, $declared, WireCodec::encodeBody($state->contract, $declared, $facts['items'] ?? []));
        [$body, $headers] = PageReply::render($state, RawTarget::query($request), RawTarget::path($request), is_array($items) ? array_values($items) : [], $facts, $status);

        return new Response(json_encode($body, self::JSON_FLAGS), $status, ['Content-Type' => $media, ...$headers]);
    }

    /** The reply of a generated exception a handler threw: one of the operation's codes, written by the boundary. */
    public static function thrown(Request $request, string $api, string $code, ?object $params): Response
    {
        $state = BoundaryState::required($request, $api);
        $reply = self::error($state->contract, $state->operationId, $code, self::encodedParams($state->contract, $code, $params));

        // A code the operation does not declare goes out unmarked, so the outgoing check judges it.
        return $state->contract->declares($state->operationId, $code) ? $state->author($reply) : $reply;
    }

    // The errors result carries its code and params object; the params are written as the code's params schema says.
    private static function errorResult(ApiContract $contract, string $operationId, object $result): Response
    {
        $code = self::member($result, 'code');
        if (!is_string($code) || !$contract->declares($operationId, $code)) {
            throw new \LogicException("seampact: the handler of operation '{$operationId}' returned an error the operation does not declare.");
        }

        return self::error($contract, $operationId, $code, self::encodedParams($contract, $code, self::member($result, 'params')));
    }

    /** The params of `$code` as the wire writes them. */
    public static function encodedParams(ApiContract $contract, string $code, mixed $params): ?\stdClass
    {
        $schema = Ir::string($contract->catalogEntry($code), 'params');
        if ($schema === null || !is_object($params)) {
            return null;
        }
        $encoded = WireCodec::encode($contract, ['kind' => 'ref', 'schema' => $schema], $params);

        return $encoded instanceof \stdClass ? $encoded : null;
    }

    /** @return array<array-key, mixed> */
    private static function declaredResponse(ApiContract $contract, string $operationId, int $status): array
    {
        foreach (Ir::maps($contract->operation($operationId), 'responses') as $response) {
            if (Ir::int($response, 'status') === $status) {
                return $response;
            }
        }

        throw new \LogicException("seampact: operation '{$operationId}' declares no {$status} response.");
    }

    private static function member(object $result, string $name): mixed
    {
        return (new \ReflectionObject($result))->hasProperty($name) ? (new \ReflectionProperty($result, $name))->getValue($result) : null;
    }
}
