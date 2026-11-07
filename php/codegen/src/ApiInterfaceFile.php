<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/**
 * An interface generated per api over a runtime one (ADR 0025 "The runtime packages"): the class the container, a
 * listener or the autoconfiguration matches by type, so two apis sharing one runtime never share one binding.
 */
final class ApiInterfaceFile
{
    private function __construct()
    {
    }

    public static function extending(string $className, string $runtimeInterface, string $comment): PhpClassFile
    {
        $file = new PhpClassFile($className);
        $file->namespace->addInterface($file->shortName)
            ->addExtend($file->type($runtimeInterface))
            ->addComment($comment);

        return $file;
    }
}
