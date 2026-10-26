<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Nette\PhpGenerator\PhpFile;
use Nette\PhpGenerator\PhpNamespace;

/**
 * One generated PHP file holding one class-like type: its namespace and the `use` lines its names need. A short name
 * belongs to the first class written with it, the type itself first; a later class with that short name stays fully
 * qualified, so a written name never changes meaning.
 */
final class PhpClassFile
{
    public readonly PhpFile $file;

    public readonly PhpNamespace $namespace;

    public readonly string $shortName;

    /** @var array<string, string> each short name in use and the class it stands for */
    private array $taken = [];

    public function __construct(public readonly string $className)
    {
        $this->file = new PhpFile();
        $this->file->setStrictTypes();
        $this->namespace = $this->file->addNamespace(self::namespaceOf($className));
        $this->shortName = self::shortNameOf($className);
        $this->taken[strtolower($this->shortName)] = $className;
    }

    public static function namespaceOf(string $className): string
    {
        $separator = strrpos($className, '\\');

        return $separator === false ? '' : substr($className, 0, $separator);
    }

    public static function shortNameOf(string $className): string
    {
        $separator = strrpos($className, '\\');

        return $separator === false ? $className : substr($className, $separator + 1);
    }

    /**
     * The name to write for `$className` in this file's code and docs: its short name when free, claimed for the rest
     * of the file (imported from another namespace), else the fully qualified name.
     */
    public function name(string $className): string
    {
        $key = strtolower(self::shortNameOf($className));
        $claimedBy = $this->taken[$key] ?? null;

        if ($claimedBy === null) {
            $this->taken[$key] = $className;
            if (self::namespaceOf($className) !== $this->namespace->getName()) {
                $this->namespace->addUse($className);
            }

            return self::shortNameOf($className);
        }

        return strcasecmp($claimedBy, $className) === 0 ? self::shortNameOf($claimedBy) : '\\' . ltrim($className, '\\');
    }

    /**
     * `$className` for a type declaration (`setType`, `setExtends`, `addImplement`), which Nette takes fully qualified
     * and the printer shortens when its `use` line is in the file; claims the short name as `name()` does.
     */
    public function type(string $className): string
    {
        $this->name($className);

        return $className;
    }

    /** The relative path of the file under the output directory, from the namespace below `$rootNamespace`. */
    public function path(string $rootNamespace): string
    {
        $relative = substr($this->className, strlen($rootNamespace) + 1);

        return str_replace('\\', '/', $relative) . '.php';
    }
}
