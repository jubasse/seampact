<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

/**
 * The page a paged list answers (ADR 0002 section 14): the limit the handler receives, then the body, headers and
 * `Link` relations the paging style writes from the handler's facts and the request's position.
 */
final class PageReply
{
    private const LIMIT_ROLE = 'limit';
    private const BEFORE_ROLE = 'before';
    private const AFTER_ROLE = 'after';
    private const CLAMP = 'clamp';
    private const NULL_ABSENT = 'null';
    private const PAGE = 'page';
    private const OFFSET = 'offset';
    private const SINCE = 'since';
    private const CURSOR = 'cursor';
    private const DEFAULT_PAGE_BASE = 1;
    private const FIRST_OFFSET = 0;
    private const LINK_HEADER = 'Link';

    private function __construct()
    {
    }

    /**
     * The query the handler receives: the route's default limit when the client sent none, and the route's `maxLimit`
     * for a larger one under `overLimit: clamp` (a larger one under `reject` was refused by step 6).
     */
    public static function withFilledLimit(BoundaryState $state, \stdClass $query): \stdClass
    {
        $paging = Ir::map($state->contract->operation($state->operationId), 'paging');
        $limitParam = self::roleName(self::style($state), self::LIMIT_ROLE);
        if ($paging === [] || $limitParam === null) {
            return $query;
        }

        $filled = clone $query;
        $limit = self::effectiveLimit($paging, $query->{$limitParam} ?? null);
        if ($limit !== null) {
            $filled->{$limitParam} = $limit;
        }

        return $filled;
    }

    /**
     * The page body and the headers its style writes, from the handler's page facts (`$items` already encoded and
     * projected), for `$status`.
     *
     * @param list<mixed> $items
     * @param array<string, mixed> $facts the handler's page facts by name, null when not given
     * @return array{mixed, array<string, string>} the body (missing when the template writes none) and the headers
     */
    public static function render(BoundaryState $state, string $rawQuery, string $requestPath, array $items, array $facts, int $status): array
    {
        $style = self::style($state);
        $writeNulls = Ir::string($style, 'absent') === self::NULL_ABSENT;
        $slots = [];
        foreach (Ir::strings($style, 'handlerResult') as $name) {
            if (($facts[$name] ?? null) !== null) {
                $slots[$name] = $facts[$name];
            }
        }

        $limit = self::limitOf($state, $style);
        if ($limit !== null) {
            $slots[self::LIMIT_ROLE] = $limit;
            if (is_int($facts['total'] ?? null) && $limit > 0) {
                $slots['totalPages'] = intdiv($facts['total'] + $limit - 1, $limit);
            }
        }
        $slots['self'] = self::pageUrl(self::withoutQueryMembers($rawQuery, []));

        $position = Ir::string($style, 'position');
        if ($position === self::PAGE || $position === self::OFFSET) {
            $slots = self::numberedSlots($state, $style, $rawQuery, $facts, count($items), $limit, $slots);
        } else {
            $slots = self::tokenSlots($style, $rawQuery, $facts, $position, $slots);
        }
        $slots['items'] = $items;
        $slots['status'] = $status;
        $slots['path'] = $requestPath;
        $meta = self::renderedMeta($style, $slots, $writeNulls);
        if ($meta !== null) {
            $slots['meta'] = $meta;
        }

        $body = Templates::render(self::pageBody($state, $style), $slots, $writeNulls);

        return [$body->present ? $body->value : new \stdClass(), self::headers($style, $slots)];
    }

    /** @return array<array-key, mixed> the paging style of the operation */
    private static function style(BoundaryState $state): array
    {
        $styleId = Ir::string(Ir::map($state->contract->operation($state->operationId), 'paging'), 'style') ?? '';

        return $state->contract->declaration('pagings', $styleId);
    }

    /**
     * The style's own body, or the format's page body, whose `$meta` the style's meta joins.
     *
     * @param array<array-key, mixed> $style
     */
    private static function pageBody(BoundaryState $state, array $style): mixed
    {
        $body = Ir::map($style, 'response')['body'] ?? null;
        if ($body !== null) {
            return $body;
        }

        return Ir::map(Ir::map(Ir::map($state->contract->format($state->operationId), 'success'), 'page'), 'body');
    }

    /**
     * The style's meta members, joined into the format's `$meta`; none leaves `$meta` without a value.
     *
     * @param array<array-key, mixed> $style
     * @param array<string, mixed> $slots
     */
    private static function renderedMeta(array $style, array $slots, bool $writeNulls): ?\stdClass
    {
        $meta = new \stdClass();
        foreach (Ir::maps(Ir::map($style, 'response'), 'meta') as $member) {
            $value = Templates::render($member['value'] ?? null, $slots, $writeNulls);
            $name = Ir::string($member, 'name') ?? '';
            if ($value->present) {
                $meta->{$name} = $value->value;
            } elseif ($writeNulls) {
                $meta->{$name} = null;
            }
        }

        return get_object_vars($meta) === [] ? null : $meta;
    }

    /**
     * @param array<array-key, mixed> $style
     * @param array<string, mixed> $slots
     * @return array<string, string>
     */
    private static function headers(array $style, array $slots): array
    {
        $headers = [];
        foreach (Ir::maps(Ir::map($style, 'response'), 'headers') as $header) {
            $value = Templates::render($header['value'] ?? null, $slots, false);
            if ($value->present && (is_string($value->value) || is_int($value->value))) {
                $headers[Ir::string($header, 'name') ?? ''] = (string) $value->value;
            }
        }

        $relations = [];
        foreach (Ir::maps(Ir::map($style, 'response'), 'links') as $link) {
            $url = $slots[Ir::string($link, 'role') ?? ''] ?? null;
            if (is_string($url)) {
                $relations[] = "<{$url}>; rel=\"" . (Ir::string($link, 'rel') ?? '') . '"';
            }
        }
        if ($relations !== []) {
            $headers[self::LINK_HEADER] = implode(', ', $relations);
        }

        return $headers;
    }

    /**
     * A page or offset position: the boundary counts the page, its records and the URLs from the request.
     *
     * @param array<array-key, mixed> $style
     * @param array<string, mixed> $facts
     * @param array<string, mixed> $slots
     * @return array<string, mixed>
     */
    private static function numberedSlots(BoundaryState $state, array $style, string $rawQuery, array $facts, int $itemCount, ?int $limit, array $slots): array
    {
        if ($limit === null || $limit <= 0) {
            throw new \LogicException("seampact: the list '{$state->operationId}' has no limit.");
        }

        $isPage = Ir::string($style, 'position') === self::PAGE;
        $positionRole = self::positionRole($style);
        $positionParam = Ir::string($positionRole, 'name') ?? '';
        $base = Ir::int($positionRole, 'base') ?? self::DEFAULT_PAGE_BASE;
        $sent = $state->query[$positionParam] ?? null;
        if ($isPage) {
            $pageNumber = is_int($sent) ? $sent : $base;
            $slots[self::PAGE] = $pageNumber;
            $pageIndex = $pageNumber - $base;
            $offset = $pageIndex > intdiv(PHP_INT_MAX, $limit) ? PHP_INT_MAX : $pageIndex * $limit;
        } else {
            $offset = is_int($sent) ? $sent : self::FIRST_OFFSET;
            $pageIndex = intdiv($offset, $limit);
        }
        $slots[self::OFFSET] = $offset;

        // A position past the last int offset has no next page and no record numbers, rather than wrapping negative.
        $nextFits = $offset <= PHP_INT_MAX - $limit;
        $hasNext = $nextFits && (in_array('more', Ir::strings($style, 'handlerResult'), true)
            ? ($facts['more'] ?? false) === true
            : is_int($facts['total'] ?? null) && $offset + $limit < $facts['total']);
        if ($itemCount > 0 && $offset <= PHP_INT_MAX - $itemCount) {
            $slots['from'] = $offset + 1;
            $slots['to'] = $offset + $itemCount;
        }

        $slots['first'] = self::pageUrl(self::withQueryMember($rawQuery, $positionParam, self::positionAt($isPage, $base, 0, $limit)));
        if ($offset > self::FIRST_OFFSET) {
            $previous = $isPage ? (string) ($base + $pageIndex - 1) : (string) max($offset - $limit, self::FIRST_OFFSET);
            $slots['previous'] = self::pageUrl(self::withQueryMember($rawQuery, $positionParam, $previous));
        }
        if ($hasNext) {
            // An offset the client chose need not fall on a page start: the next page starts one limit further.
            $next = $isPage ? self::positionAt(true, $base, $pageIndex + 1, $limit) : (string) ($offset + $limit);
            $slots['next'] = self::pageUrl(self::withQueryMember($rawQuery, $positionParam, $next));
        }
        if (is_int($slots['totalPages'] ?? null)) {
            $lastIndex = max($slots['totalPages'] - 1, 0);
            $slots['last'] = self::pageUrl(self::withQueryMember($rawQuery, $positionParam, self::positionAt($isPage, $base, $lastIndex, $limit)));
        }

        return $slots;
    }

    /**
     * A cursor or since position: the URLs carry the tokens the handler returned.
     *
     * @param array<array-key, mixed> $style
     * @param array<string, mixed> $facts
     * @param array<string, mixed> $slots
     * @return array<string, mixed>
     */
    private static function tokenSlots(array $style, string $rawQuery, array $facts, ?string $position, array $slots): array
    {
        $positionParam = Ir::string(self::positionRole($style), 'name') ?? '';
        $beforeParam = self::roleName($style, self::BEFORE_ROLE);
        $withoutPosition = self::withoutQueryMembers($rawQuery, $beforeParam === null ? [$positionParam] : [$positionParam, $beforeParam]);
        $slots['first'] = self::pageUrl($withoutPosition);

        $tokens = $position === self::SINCE
            ? ['next' => [$positionParam, $facts['nextSince'] ?? null]]
            : ['next' => [$positionParam, $facts['nextCursor'] ?? null], 'previous' => [$beforeParam ?? $positionParam, $facts['previousCursor'] ?? null]];
        foreach ($tokens as $role => [$param, $token]) {
            if (is_string($token)) {
                $slots[$role] = self::pageUrl(self::withQueryMember($withoutPosition, $param, $token));
            }
        }

        return $slots;
    }

    private static function positionAt(bool $isPage, int $base, int $index, int $limit): string
    {
        return (string) ($isPage ? $base + $index : $index * $limit);
    }

    /**
     * A cursor kind may carry its position in `after` and `before` instead of `cursor`.
     *
     * @param array<array-key, mixed> $style
     * @return array<array-key, mixed>
     */
    private static function positionRole(array $style): array
    {
        $position = Ir::string($style, 'position');
        $role = self::roleOf($style, $position ?? '') ?? ($position === self::CURSOR ? self::roleOf($style, self::AFTER_ROLE) : null);

        return $role ?? throw new \LogicException("seampact: the paging style '" . (Ir::string($style, 'id') ?? '') . "' has no position role.");
    }

    /** @param array<array-key, mixed> $style */
    private static function roleName(array $style, string $role): ?string
    {
        return Ir::string(self::roleOf($style, $role) ?? [], 'name');
    }

    /**
     * @param array<array-key, mixed> $style
     * @return ?array<array-key, mixed>
     */
    private static function roleOf(array $style, string $role): ?array
    {
        foreach (Ir::maps($style, 'request') as $declared) {
            if (Ir::string($declared, 'role') === $role) {
                return $declared;
            }
        }

        return null;
    }

    /** @param array<array-key, mixed> $style */
    private static function limitOf(BoundaryState $state, array $style): ?int
    {
        $limitParam = self::roleName($style, self::LIMIT_ROLE);
        $paging = Ir::map($state->contract->operation($state->operationId), 'paging');
        if ($limitParam === null) {
            return Ir::int($paging, 'defaultLimit');
        }

        return self::effectiveLimit($paging, $state->query[$limitParam] ?? null);
    }

    /**
     * The limit the handler works with: the default for none sent, `maxLimit` for a larger one under `clamp`.
     *
     * @param array<array-key, mixed> $paging
     */
    private static function effectiveLimit(array $paging, mixed $sent): ?int
    {
        if (!is_int($sent)) {
            return Ir::int($paging, 'defaultLimit');
        }

        $maxLimit = Ir::int($paging, 'maxLimit');

        return Ir::string($paging, 'overLimit') === self::CLAMP && $maxLimit !== null && $sent > $maxLimit ? $maxLimit : $sent;
    }

    /** @param list<string> $names */
    private static function withoutQueryMembers(string $rawQuery, array $names): string
    {
        $kept = array_filter(explode('&', $rawQuery), static fn (string $pair): bool => $pair !== '' && !in_array(urldecode(explode('=', $pair, 2)[0]), $names, true));

        return implode('&', $kept);
    }

    private static function withQueryMember(string $rawQuery, string $name, string $value): string
    {
        $kept = self::withoutQueryMembers($rawQuery, [$name]);
        $member = rawurlencode($name) . '=' . rawurlencode($value);

        return $kept === '' ? $member : "{$kept}&{$member}";
    }

    // A query-only reference (RFC 3986): it resolves against the URL the client called, so it keeps a path prefix a
    // reverse proxy stripped. An empty query is `?`, since an empty reference would keep the called query.
    private static function pageUrl(string $query): string
    {
        return '?' . $query;
    }
}
