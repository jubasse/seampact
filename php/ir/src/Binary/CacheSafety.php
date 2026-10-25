<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** The cache checks run on the private copy of the binary before each start (`binary.cache-unsafe`). */
interface CacheSafety
{
    /** Creates the cache root, each missing directory on its way and `$directory` owner-only, whatever the umask. */
    public function createPrivateDirectory(string $directory): void;

    /** @throws BinaryRefusedException `binary.cache-unsafe`, naming the path */
    public function refuseUnsafe(string $copyPath): void;
}
