<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The Windows facts read through Windows PowerShell (`Get-Item`, `Get-Acl`), by SID so no account name depends on
 * the system language. A write right is any right to write data, add a file or a folder, delete, or change the
 * permissions or the owner, generic write and generic all included.
 */
final class PowerShellPathFacts implements WindowsPathFacts
{
    // WriteData 0x2, AppendData 0x4, DeleteSubdirectoriesAndFiles 0x40, Delete 0x10000, ChangePermissions
    // 0x40000, TakeOwnership 0x80000, GENERIC_ALL 0x10000000, GENERIC_WRITE 0x40000000.
    private const WRITE_RIGHTS = 0x2 | 0x4 | 0x40 | 0x10000 | 0x40000 | 0x80000 | 0x10000000 | 0x40000000;

    private const PATHS_VARIABLE = 'SEAMPACT_ACL_PATHS';

    private const SCRIPT = <<<'POWERSHELL'
        $ErrorActionPreference = 'Stop'
        $paths = ConvertFrom-Json $env:SEAMPACT_ACL_PATHS
        $facts = @()
        foreach ($path in $paths) {
            if (-not (Test-Path -LiteralPath $path)) { continue }
            $item = Get-Item -LiteralPath $path -Force
            $writers = @()
            foreach ($entry in (Get-Acl -LiteralPath $path).Access) {
                $rights = [long]$entry.FileSystemRights
                if ($entry.AccessControlType -eq 'Allow' -and ($rights -band WRITE_RIGHTS) -ne 0) {
                    $writers += $entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
                }
            }
            $reparse = ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
            $facts += @{ path = $path; reparse = $reparse; writers = @($writers) }
        }
        $user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        ConvertTo-Json -Compress -Depth 4 @{ user = $user; facts = @($facts) }
        POWERSHELL;

    private ?\stdClass $lastRead = null;

    public function of(array $paths): array
    {
        $read = $this->read($paths);
        $facts = [];

        foreach (is_array($read->facts ?? null) ? $read->facts : [] as $fact) {
            if ($fact instanceof \stdClass && is_string($fact->path ?? null) && is_array($fact->writers ?? null)) {
                $writers = array_values(array_filter($fact->writers, is_string(...)));
                $facts[$fact->path] = new WindowsPathFact($fact->reparse === true, $writers);
            }
        }

        return $facts;
    }

    public function currentUserSid(): string
    {
        $user = ($this->lastRead ?? $this->read([]))->user ?? null;

        return is_string($user) ? $user : throw self::unreadable('the current user has no SID');
    }

    /** @param list<string> $paths */
    private function read(array $paths): \stdClass
    {
        $systemRoot = getenv('SystemRoot');
        if (!is_string($systemRoot) || $systemRoot === '') {
            throw self::unreadable('SystemRoot is not set, so Windows PowerShell cannot be found');
        }

        $command = [
            $systemRoot . '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', str_replace('WRITE_RIGHTS', (string) self::WRITE_RIGHTS, self::SCRIPT),
        ];
        $environment = getenv();
        $environment[self::PATHS_VARIABLE] = json_encode($paths, JSON_THROW_ON_ERROR);

        $process = proc_open($command, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $environment);
        if (!is_resource($process)) {
            throw self::unreadable('Windows PowerShell does not start');
        }

        $output = (string) stream_get_contents($pipes[1]);
        $errors = (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($process);
        $read = json_decode($output, false);

        if ($exitCode !== 0 || !$read instanceof \stdClass) {
            throw self::unreadable("Windows PowerShell exited with {$exitCode}: " . trim($errors));
        }

        return $this->lastRead = $read;
    }

    private static function unreadable(string $problem): BinaryRefusedException
    {
        return BinaryRefusedException::of(
            BinaryFailureCode::CacheUnsafe,
            "The ACL of the binary cache cannot be read: {$problem}.",
            'Run seampact where Windows PowerShell can read the ACL of %LOCALAPPDATA%\\seampact.',
        );
    }
}
