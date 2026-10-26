<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Config\ConfigPath;
use Seampact\Ir\Config\ConfigProblem;

/**
 * The PSR-4 `autoload` entries of the app's root `composer.json`: the generated code is autoloaded like the app's
 * own, so `outDir` must sit at or below one of their directories (`config.php.autoload-missing`), and each output
 * directory's namespace follows from the deepest such entry, each directory below it one namespace segment.
 */
final readonly class Psr4Namespaces
{
    private const IDENTIFIER = '/^[A-Za-z_][A-Za-z0-9_]*$/D';

    /** @param array<string, string> $prefixByDirectory each absolute directory and its namespace prefix */
    private function __construct(private string $composerFile, private array $prefixByDirectory)
    {
    }

    public static function of(string $composerFile): self
    {
        $text = @file_get_contents($composerFile);
        $document = $text === false ? null : json_decode($text, false);
        $autoload = $document instanceof \stdClass ? $document->autoload ?? null : null;
        $psr4 = $autoload instanceof \stdClass ? $autoload->{'psr-4'} ?? null : null;
        $prefixByDirectory = [];

        foreach ($psr4 instanceof \stdClass ? get_object_vars($psr4) : [] as $prefix => $directories) {
            foreach (is_array($directories) ? $directories : [$directories] as $directory) {
                if (is_string($directory)) {
                    $prefixByDirectory[ConfigPath::resolve(dirname($composerFile), $directory)] = rtrim((string) $prefix, '\\');
                }
            }
        }

        return new self($composerFile, $prefixByDirectory);
    }

    /** The refusal of an `outDir` no PSR-4 directory holds, or null. */
    public function outDirProblem(string $outDir, string $configName): ?ConfigProblem
    {
        if ($this->deepestDirectory($outDir) !== null) {
            return null;
        }

        return new ConfigProblem(
            'config.php.autoload-missing',
            "No PSR-4 `autoload` entry of {$this->composerFile} holds `outDir` ({$outDir}), so the generated classes would not load.",
            'Add a PSR-4 entry for the directory, such as "App\\\\Generated\\\\": "' . basename($outDir) . '/", or set `outDir` below a directory one already maps, then run `composer dump-autoload`.',
            "{$configName} outDir",
        );
    }

    /** The namespace of `$directory`, or the refusal of a directory segment that is not a PHP name. */
    public function namespaceOf(string $directory, string $where): string|ConfigProblem
    {
        $root = $this->deepestDirectory($directory);
        if ($root === null) {
            throw new \LogicException('seampact: the namespace of a directory outside every PSR-4 entry was asked.');
        }

        $segments = $directory === $root ? [] : explode('/', substr($directory, strlen($root) + 1));
        foreach ($segments as $segment) {
            if (preg_match(self::IDENTIFIER, $segment) !== 1) {
                return new ConfigProblem(
                    'config.php.namespace-invalid',
                    "The output directory {$directory} holds the segment '{$segment}', which is not a PHP namespace name, so PSR-4 cannot load its classes.",
                    "Name the entry's `out`, its id or its api with letters, digits and '_' only.",
                    $where,
                );
            }
        }

        return implode('\\', array_filter([$this->prefixByDirectory[$root], ...$segments], static fn (string $part): bool => $part !== ''));
    }

    private function deepestDirectory(string $directory): ?string
    {
        $deepest = null;

        foreach (array_keys($this->prefixByDirectory) as $candidate) {
            $candidate = (string) $candidate;
            if (ConfigPath::isAtOrBelow($directory, $candidate) && ($deepest === null || strlen($candidate) > strlen($deepest))) {
                $deepest = $candidate;
            }
        }

        return $deepest;
    }
}
