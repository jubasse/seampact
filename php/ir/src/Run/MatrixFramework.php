<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

/**
 * A PHP target's framework as the compatibility matrix records it: the majors it is tested on, those it does not
 * work on, and the `floor`, the lowest `<major>.<minor>` it works on, null without one.
 */
final readonly class MatrixFramework
{
    private const FLOOR_PATTERN = '/^\d+\.\d+$/D';

    /**
     * @param list<int> $testedMajors
     * @param array<int, string> $incompatible the reason of each major the target does not work on
     */
    public function __construct(public string $id, public string $package, public array $testedMajors, public array $incompatible, public ?string $floor = null)
    {
    }

    /** @return array{string, self} the target's `use` package and its framework */
    public static function of(mixed $target): array
    {
        $framework = $target instanceof \stdClass ? $target->framework ?? null : null;
        $package = $target instanceof \stdClass ? $target->package ?? null : null;
        if (!is_string($package) || !$framework instanceof \stdClass || !is_string($framework->id ?? null) || !is_string($framework->package ?? null)
            || !is_array($framework->tested ?? null) || !is_array($framework->incompatible ?? null)) {
            throw new \LogicException('resources/compatibility/matrix.json holds a phpTargets item without a package and a framework; reinstall seampact/ir.');
        }

        $tested = array_map(static fn (mixed $item): int => self::major($item, $package), $framework->tested);
        $incompatible = [];
        foreach ($framework->incompatible as $item) {
            $reason = $item instanceof \stdClass ? $item->reason ?? null : null;
            $incompatible[self::major($item, $package)] = is_string($reason) ? $reason : throw new \LogicException("resources/compatibility/matrix.json: an incompatible major of {$package} has no reason.");
        }

        $floor = $framework->floor ?? null;
        if ($floor !== null && (!is_string($floor) || preg_match(self::FLOOR_PATTERN, $floor) !== 1)) {
            throw new \LogicException("resources/compatibility/matrix.json: the floor of {$package} is not <major>.<minor>; reinstall seampact/ir.");
        }

        return [$package, new self($framework->id, $framework->package, array_values($tested), $incompatible, $floor)];
    }

    /** @return list<string> the `allowUntested` items that name a tested major */
    public function testedItems(): array
    {
        return array_map(fn (int $major): string => "{$this->id}@{$major}", $this->testedMajors);
    }

    /** Whether `$major`.`$minor` is below the floor. */
    public function isBelowFloor(int $major, int $minor): bool
    {
        return $this->floor !== null && version_compare("{$major}.{$minor}", $this->floor, '<');
    }

    public function testedText(): string
    {
        return implode(', ', $this->testedMajors);
    }

    private static function major(mixed $item, string $package): int
    {
        $major = $item instanceof \stdClass ? $item->major ?? null : null;

        return is_int($major) ? $major : throw new \LogicException("resources/compatibility/matrix.json: a major of {$package} is not an integer.");
    }
}
