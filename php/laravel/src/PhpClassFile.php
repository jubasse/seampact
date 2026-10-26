<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Nette\PhpGenerator\PhpFile;
use Nette\PhpGenerator\PhpNamespace;

/**
 * One generated PHP file holding one class-like type: its namespace and the `use` lines its names need. A name whose
 * short form another import or the type itself already takes stays qualified.
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

    /** The name to write for `$className` in this file's code and docs, imported when its short name is free. */
    public function name(string $className): string
    {
        $short = self::shortNameOf($className);
        $key = strtolower($short);

        if (self::namespaceOf($className) !== $this->namespace->getName() && !isset($this->taken[$key])) {
            $this->namespace->addUse($className);
            $this->taken[$key] = $className;
        }

        return $this->namespace->simplifyName($className);
    }

    /** The relative path of the file under the output directory, from the namespace below `$rootNamespace`. */
    public function path(string $rootNamespace): string
    {
        $relative = substr($this->className, strlen($rootNamespace) + 1);

        return str_replace('\\', '/', $relative) . '.php';
    }
}
