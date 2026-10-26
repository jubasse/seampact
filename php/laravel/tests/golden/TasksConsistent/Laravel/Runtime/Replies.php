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
    private const NULL_ABSENT = 'null';
    private const NO_CONTENT = 204;

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

        return new Response(
            json_encode($body->present ? $body->value : new \stdClass(), self::JSON_FLAGS),
            $contract->statusOf($code),
            ['Content-Type' => Ir::string($error, 'media') ?? self::JSON_MEDIA],
        );
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

        $body = WireCodec::encodeBody($contract, $declared, self::member($result, 'body'));
        $body = FieldRights::output($state, $declared, $body);
        $media = Ir::string($declared, 'media') ?? Ir::string($contract->format($operationId), 'media') ?? self::JSON_MEDIA;

        return $state->author(new Response(json_encode($body, self::JSON_FLAGS), $status, ['Content-Type' => $media]));
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
