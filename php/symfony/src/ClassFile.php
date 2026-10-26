<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Nette\PhpGenerator\PhpFile;
use Nette\PhpGenerator\PhpNamespace;

/**
 * One generated PHP file holding one class-like type: its namespace and the `use` lines its names need. A name whose
 * short form another import or the type itself already takes stays fully qualified.
 */
final class ClassFile
{
    public readonly PhpFile $file;
    public readonly PhpNamespace $namespace;
    public readonly string $shortName;

    /** @var array<string, string> each imported short name, lower-cased, and its class */
    private array $imported = [];

    public function __construct(public readonly string $className)
    {
        $this->file = new PhpFile();
        $this->file->setStrictTypes();
        $this->namespace = $this->file->addNamespace(self::namespaceOf($className));
        $this->shortName = self::shortNameOf($className);
    }

    public static function namespaceOf(string $className): string
    {
        $last = strrpos($className, '\\');

        return $last === false ? '' : substr($className, 0, $last);
    }

    public static function shortNameOf(string $className): string
    {
        $last = strrpos($className, '\\');

        return $last === false ? $className : substr($className, $last + 1);
    }

    /** The name to write for `$className` in this file's code, importing it when its short form is free. */
    public function name(string $className): string
    {
        $short = self::shortNameOf($className);
        if ($className === $this->className) {
            return $short;
        }

        $key = strtolower($short);
        $taken = $this->imported[$key] ?? null;
        if ($taken === $className) {
            return $short;
        }
        if ($taken !== null || $key === strtolower($this->shortName)) {
            return '\\' . $className;
        }

        $this->imported[$key] = $className;
        if (self::namespaceOf($className) !== $this->namespace->getName()) {
            $this->namespace->addUse($className);
        }

        return $short;
    }

    /** `$className` for a type declaration, which the printer shortens; its `use` line is added as `name()` adds it. */
    public function type(string $className): string
    {
        $this->name($className);

        return $className;
    }

    /** The file's POSIX path relative to the directory of `$rootNamespace`. */
    public function path(string $rootNamespace): string
    {
        $relative = substr($this->className, strlen($rootNamespace) + 1);

        return str_replace('\\', '/', $relative) . '.php';
    }
}
