<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/**
 * Why an app config, or a run built on it, is refused: the same `code` as the Node CLI gives for the same case, a
 * `message`, its `fix`, and `where` it is (`<file> <key path>`, `entry '<id>'`, `source '<name>'`...).
 */
final readonly class ConfigProblem
{
    public function __construct(public string $code, public string $message, public string $fix, public ?string $where = null)
    {
    }

    public function withWhere(string $where): self
    {
        return new self($this->code, $this->message, $this->fix, $where);
    }

    /**
     * The text a run prints for `$problems`: one block per problem, its code and place, its message and fix.
     *
     * @param list<self> $problems
     */
    public static function text(array $problems): string
    {
        $blocks = array_map(
            static fn (self $problem): string => $problem->code
                . ($problem->where === null ? '' : " ({$problem->where})")
                . ": {$problem->message}\n    Fix: {$problem->fix}",
            $problems,
        );

        return implode("\n", $blocks);
    }
}
