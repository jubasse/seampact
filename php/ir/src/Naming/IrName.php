<?php

declare(strict_types=1);

namespace Seampact\Ir\Naming;

/**
 * A name as the IR stores it (ADR 0007 section 1): word segments and a role. A `response` name carries the integer
 * `status` (200 to 399), and no other role does.
 */
final readonly class IrName
{
    private const SEGMENT = '/^[a-z0-9]+$/D';

    private const MIN_RESPONSE_STATUS = 200;

    private const MAX_RESPONSE_STATUS = 399;

    /**
     * @param list<string> $segments
     * @throws \InvalidArgumentException a segment outside `[a-z0-9]+`, or a status missing, out of range or on another role
     */
    public function __construct(public array $segments, public NamingRole $role, public ?int $status = null)
    {
        self::assertSegments($segments);

        if ($role === NamingRole::Response) {
            if ($status === null || $status < self::MIN_RESPONSE_STATUS || $status > self::MAX_RESPONSE_STATUS) {
                throw new \InvalidArgumentException(
                    'a response status is an integer from ' . self::MIN_RESPONSE_STATUS . ' to '
                    . self::MAX_RESPONSE_STATUS . ', got ' . ($status ?? 'none'),
                );
            }
        } elseif ($status !== null) {
            throw new \InvalidArgumentException("role {$role->value} has no status, got $status");
        }
    }

    /**
     * @param list<string> $segments
     * @throws \InvalidArgumentException a segment outside `[a-z0-9]+`
     */
    public static function assertSegments(array $segments): void
    {
        foreach ($segments as $segment) {
            if (preg_match(self::SEGMENT, $segment) !== 1) {
                throw new \InvalidArgumentException("a naming segment is [a-z0-9]+, got '$segment'");
            }
        }
    }

    /**
     * The segments, then the suffix words of the role (the status follows `response`).
     *
     * @return list<string>
     */
    public function words(): array
    {
        $suffix = $this->role->suffixWord();

        if ($suffix === null) {
            return $this->segments;
        }

        return [...$this->segments, $suffix, ...($this->status === null ? [] : [(string) $this->status])];
    }
}
