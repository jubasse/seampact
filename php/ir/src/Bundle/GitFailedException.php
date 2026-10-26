<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/** A git command of the git-tag channel failed; the message is git's own reason, or the bound it crossed. */
final class GitFailedException extends \RuntimeException
{
}
