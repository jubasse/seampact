<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

/** Declares a handler class in a fresh PHP process, since a return type that does not fit its interface is a fatal error at declaration. */
final class HandlerDeclaration
{
    /**
     * The exit code and the output of loading [$classSource] after the autoloader of [$autoloadPath].
     *
     * @return array{succeeded: bool, output: string}
     */
    public static function load(string $autoloadPath, string $classSource): array
    {
        $script = tempnam(sys_get_temp_dir(), 'seampact-handler-');
        if ($script === false) {
            throw new \RuntimeException('Could not create the handler script.');
        }

        try {
            file_put_contents($script, "<?php\ndeclare(strict_types=1);\nrequire " . var_export($autoloadPath, true) . ";\n" . $classSource . "\necho 'declared';\n");
            exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($script) . ' 2>&1', $output, $exitCode);
        } finally {
            unlink($script);
        }

        return ['succeeded' => $exitCode === 0, 'output' => implode("\n", $output)];
    }
}
