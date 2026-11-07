<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Binary\BinaryFailure;
use Seampact\Ir\Bundle\BundleFailure;
use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Read\IrRefusal;
use Seampact\Ir\Write\WriterRefusal;

/**
 * Every refusal of a run as one shape, the config problem's (code, message, fix, where), so a run prints them alike
 * and the codes stay those of the Node CLI and the `seampact/ir` readers.
 */
final class RunProblems
{
    private function __construct()
    {
    }

    public static function ofBundle(BundleFailure $failure, string $source): ConfigProblem
    {
        $values = array_filter([
            $failure->expected === null ? null : "expected {$failure->expected}",
            $failure->actual === null ? null : "actual {$failure->actual}",
        ]);
        $detail = $values === [] ? '' : ' (' . implode(', ', $values) . ')';

        return new ConfigProblem(
            $failure->code->value,
            $failure->message . $detail,
            $failure->fix,
            "source '{$source}'" . ($failure->file === null ? '' : " {$failure->file}"),
        );
    }

    public static function ofBinary(BinaryFailure $failure, string $where): ConfigProblem
    {
        return new ConfigProblem($failure->code->value, $failure->message, $failure->fix, $where);
    }

    public static function ofWriter(WriterRefusal $refusal, string $where): ConfigProblem
    {
        return new ConfigProblem($refusal->code, $refusal->message, $refusal->fix, $where);
    }

    public static function ofIr(IrRefusal $refusal, string $use, string $where): ConfigProblem
    {
        return new ConfigProblem(
            $refusal->code->value,
            $refusal->message,
            "Use a contract this release of {$use} reads, or update {$use}.",
            "{$where} {$refusal->member}",
        );
    }
}
