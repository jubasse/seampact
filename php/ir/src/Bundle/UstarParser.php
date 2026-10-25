<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * The ustar entries of a bundle tarball (POSIX.1-1988 with pax extended headers), read block by block from the
 * uncompressed archive in a private temporary file, each checked before the next is read; a file's bytes stay in
 * the archive, located by offset and size: regular files and directories only, pax extended headers for
 * `path` and `size` only, global pax headers ignored, every other type refused; a file is the manifest or a
 * portable bundle path, a directory one of their parents; no duplicate (also once folded to ASCII lower case) or
 * path that is both a file and a directory. Entry names are untrusted: quoted in messages, kept exact in `file`.
 */
final class UstarParser
{
    private const BLOCK_BYTES = 512;

    // [offset, length] of each header field.
    private const NAME = [0, 100];
    private const SIZE = [124, 12];
    private const CHECKSUM = [148, 8];
    private const TYPE = [156, 1];
    private const MAGIC = [257, 6];
    private const VERSION = [263, 2];
    private const PREFIX = [345, 155];

    // The magic and version fields read as one, as GNU writes them.
    private const GNU_MAGIC_FIELD = [257, 8];

    private const USTAR_MAGIC = "ustar\0";
    private const USTAR_VERSION = '00';

    // GNU tar's magic and version, one 8-byte field: read like ustar's, since its regular and directory entries agree.
    private const GNU_MAGIC_AND_VERSION = "ustar  \0";

    private const TYPE_FILE = '0';

    // Pre-POSIX archives mark a regular file with a NUL type.
    private const TYPE_FILE_OLD = "\0";
    private const TYPE_DIRECTORY = '5';
    private const PAX_TYPE_EXTENDED = 'x';
    private const PAX_TYPE_GLOBAL = 'g';

    private const CHECKSUM_SPACE = 0x20;

    private int $offset = 0;

    private int $entryCount = 0;

    private ?string $paxPath = null;

    private ?int $paxSize = null;

    /** @var list<BundleEntry> */
    private array $files = [];

    /** @var array<string, string> the files by path folded to ASCII lower case */
    private array $fileByFold = [];

    /** @var array<string, true> every directory folded (an entry's or a file's parent) */
    private array $directoryFolds = [];

    /** @var resource */
    private $archive;

    /** @param resource $archive the uncompressed archive, of `$archiveBytes` bytes */
    public function __construct($archive, private readonly int $archiveBytes)
    {
        $this->archive = $archive;
    }

    public function parse(): BundleArchiveRead
    {
        while (true) {
            if ($this->offset + self::BLOCK_BYTES > $this->archiveBytes) {
                return BundleArchiveRead::refused(BundleArchiveRead::archiveInvalid('it ends before its end-of-archive block'));
            }

            $header = $this->bytesAt($this->offset, self::BLOCK_BYTES);
            if (trim($header, "\0") === '') {
                return BundleArchiveRead::read($this->files);
            }

            $failure = $this->entry($header);
            if ($failure !== null) {
                return BundleArchiveRead::refused($failure);
            }
        }
    }

    private function entry(string $header): ?BundleFailure
    {
        $this->entryCount++;
        if ($this->entryCount > BundleLayout::ENTRIES_MAX) {
            return new BundleFailure(
                BundleFailureCode::ArchiveTooManyEntries,
                'The tarball holds more than ' . BundleLayout::ENTRIES_MAX . ' entries.',
                BundleLayout::NOT_A_BUNDLE_FIX,
                expected: (string) BundleLayout::ENTRIES_MAX,
            );
        }

        $headerProblem = self::headerProblem($header);
        if ($headerProblem !== null) {
            return BundleArchiveRead::archiveInvalid($headerProblem);
        }

        $type = self::field($header, self::TYPE, true);
        $path = $this->paxPath ?? self::headerPath($header);
        $size = $this->paxSize ?? self::octal($header, self::SIZE);
        if ($size === null) {
            return BundleArchiveRead::archiveInvalid("an entry's size is not octal digits", $path);
        }

        $dataStart = $this->offset + self::BLOCK_BYTES;
        // Subtracted, not added: a pax size near PHP_INT_MAX would overflow the sum.
        if ($size > $this->archiveBytes - $dataStart) {
            return BundleArchiveRead::archiveInvalid('it ends inside an entry', $path);
        }

        $this->offset = $dataStart + intdiv($size + self::BLOCK_BYTES - 1, self::BLOCK_BYTES) * self::BLOCK_BYTES;

        return $this->typed($type, $path, $dataStart, $size);
    }

    private function typed(string $type, string $path, int $dataStart, int $size): ?BundleFailure
    {
        if ($type === self::PAX_TYPE_GLOBAL) {
            return null;
        }

        if ($type === self::PAX_TYPE_EXTENDED) {
            return $this->readPax($this->bytesAt($dataStart, $size), $path);
        }

        $this->paxPath = null;
        $this->paxSize = null;

        if ($type === self::TYPE_DIRECTORY) {
            return $this->directory($path);
        }

        if ($type === self::TYPE_FILE || $type === self::TYPE_FILE_OLD) {
            return $this->file($path, $dataStart, $size);
        }

        return new BundleFailure(
            BundleFailureCode::ArchiveEntryType,
            'The tarball entry ' . BundleText::quoted($path) . ' is of type ' . BundleText::quoted($type) . '; a bundle holds regular files only.',
            'Rebuild the bundle with `seampact bundle`: it writes no link, device or other special entry.',
            $path,
        );
    }

    private static function headerProblem(string $header): ?string
    {
        $magic = self::field($header, self::MAGIC, true);
        $version = self::field($header, self::VERSION, true);

        if ($magic !== self::USTAR_MAGIC && $magic . $version !== self::GNU_MAGIC_AND_VERSION) {
            return 'an entry is not a ustar header';
        }

        if ($magic === self::USTAR_MAGIC && $version !== self::USTAR_VERSION) {
            return 'an entry has an unknown ustar version';
        }

        if (self::octal($header, self::CHECKSUM) !== self::checksum($header)) {
            return "an entry header's checksum does not match";
        }

        return null;
    }

    private function directory(string $path): ?BundleFailure
    {
        $trimmed = str_ends_with($path, '/') ? substr($path, 0, -1) : $path;
        $problem = self::directoryPathProblem($trimmed);
        if ($problem !== null) {
            return self::unsafePath($path, $problem);
        }

        if (isset($this->fileByFold[BundlePath::fold($trimmed)])) {
            return self::unsafePath($path, 'is both a file and a directory');
        }

        $this->addParentDirectories($trimmed);
        $this->directoryFolds[BundlePath::fold($trimmed)] = true;

        return null;
    }

    private function file(string $path, int $dataStart, int $size): ?BundleFailure
    {
        $problem = self::filePathProblem($path);
        if ($problem !== null) {
            return self::unsafePath($path, $problem);
        }

        $folded = BundlePath::fold($path);
        $seen = $this->fileByFold[$folded] ?? null;
        if ($seen !== null) {
            return new BundleFailure(
                BundleFailureCode::ArchiveEntryDuplicate,
                $seen === $path
                    ? 'The tarball holds ' . BundleText::quoted($path) . ' twice.'
                    : 'The tarball holds ' . BundleText::quoted($path) . ' and ' . BundleText::quoted($seen) . ', one file on a case-insensitive file system.',
                'Rebuild the bundle with `seampact bundle`: it writes each file once.',
                $path,
            );
        }

        if (isset($this->directoryFolds[$folded]) || $this->hasFileParent($path)) {
            return self::unsafePath($path, 'is both a file and a directory');
        }

        $this->fileByFold[$folded] = $path;
        $this->addParentDirectories($path);
        $this->files[] = new BundleEntry($path, $dataStart, $size);

        return null;
    }

    private function bytesAt(int $offset, int $length): string
    {
        if ($length < 1) {
            return '';
        }

        $bytes = fseek($this->archive, $offset) === 0 ? fread($this->archive, $length) : false;

        if ($bytes === false || strlen($bytes) !== $length) {
            throw new \RuntimeException("bundle: reading {$length} bytes at {$offset} of the uncompressed tarball failed; check the free space of the temporary directory.");
        }

        return $bytes;
    }

    private function hasFileParent(string $path): bool
    {
        foreach (self::parentPaths($path) as $parent) {
            if (isset($this->fileByFold[BundlePath::fold($parent)])) {
                return true;
            }
        }

        return false;
    }

    private function addParentDirectories(string $path): void
    {
        foreach (self::parentPaths($path) as $parent) {
            $this->directoryFolds[BundlePath::fold($parent)] = true;
        }
    }

    // A pax extended header's records, `<length> <key>=<value>\n`: `path` and `size` are read, the others ignored.
    private function readPax(string $data, string $entryPath): ?BundleFailure
    {
        $path = null;
        $size = null;
        $offset = 0;
        $length = strlen($data);

        while ($offset < $length) {
            $space = strpos($data, ' ', $offset);
            $lengthText = $space === false ? '' : substr($data, $offset, $space - $offset);
            $recordLength = preg_match('/^[0-9]+$/D', $lengthText) === 1 ? (int) $lengthText : 0;

            if ($space === false || $recordLength <= 0 || $recordLength > $length - $offset) {
                return BundleArchiveRead::archiveInvalid("a pax record's length is not a number inside the header", $entryPath);
            }

            $recordEnd = $offset + $recordLength - 1;
            $record = $space + 1 <= $recordEnd ? substr($data, $space + 1, $recordEnd - $space - 1) : '';
            $equals = strpos($record, '=');
            if ($equals === false || $data[$recordEnd] !== "\n") {
                return BundleArchiveRead::archiveInvalid('a pax record is not key=value', $entryPath);
            }

            $key = substr($record, 0, $equals);
            $value = substr($record, $equals + 1);
            if ($key === 'path') {
                $path = $value;
            }
            if ($key === 'size') {
                if (preg_match('/^[0-9]{1,18}$/D', $value) !== 1) {
                    return BundleArchiveRead::archiveInvalid('a pax size is not a decimal number', $entryPath);
                }
                $size = (int) $value;
            }

            $offset += $recordLength;
        }

        $this->paxPath = $path;
        $this->paxSize = $size;

        return null;
    }

    /** @return list<string> `a`, `a/b` for `a/b/c` */
    private static function parentPaths(string $path): array
    {
        $segments = explode('/', $path);
        $parents = [];
        for ($count = 1; $count < count($segments); $count++) {
            $parents[] = implode('/', array_slice($segments, 0, $count));
        }

        return $parents;
    }

    private static function unsafePath(string $path, string $problem): BundleFailure
    {
        return new BundleFailure(
            BundleFailureCode::ArchiveEntryPath,
            'The tarball entry ' . BundleText::quoted($path) . " {$problem}; a bundle holds its manifest and portable paths under sources/ and ir/ only.",
            'Rebuild the bundle with `seampact bundle`: its entries are the manifest and portable paths under the bundle root.',
            $path,
        );
    }

    // The manifest, or a portable bundle path.
    private static function filePathProblem(string $path): ?string
    {
        if ($path === BundleLayout::MANIFEST_FILE) {
            return null;
        }

        return self::entryPathProblem($path) ?? BundlePath::problem($path);
    }

    // `sources`, `ir`, or a directory a portable bundle path may hold.
    private static function directoryPathProblem(string $path): ?string
    {
        if ($path === BundleLayout::SOURCES_DIRECTORY || $path === BundleLayout::IR_DIRECTORY) {
            return null;
        }

        return self::entryPathProblem($path) ?? BundlePath::problem($path);
    }

    // The unsafe paths, named before the portable rule so the refusal says what makes them unsafe.
    private static function entryPathProblem(string $path): ?string
    {
        return match (true) {
            $path === '' => 'has an empty path',
            str_contains($path, "\0") => 'holds a NUL character',
            str_contains($path, '\\') => 'holds a backslash',
            str_starts_with($path, '/') || preg_match('/^[A-Za-z]:/', $path) === 1 => 'is an absolute path',
            array_intersect(explode('/', $path), ['', '.', '..']) !== [] => "has an empty, '.' or '..' segment",
            default => null,
        };
    }

    // GNU headers hold times where ustar holds the prefix: their path is the name field only.
    private static function headerPath(string $header): string
    {
        $name = self::field($header, self::NAME, false);
        $isGnu = self::field($header, self::GNU_MAGIC_FIELD, true) === self::GNU_MAGIC_AND_VERSION;
        $prefix = $isGnu ? '' : self::field($header, self::PREFIX, false);

        return BundleText::utf8OrReplaced($prefix === '' ? $name : "{$prefix}/{$name}");
    }

    /** @param array{int, int} $field */
    private static function field(string $header, array $field, bool $keepNul): string
    {
        $text = substr($header, $field[0], $field[1]);
        if ($keepNul) {
            return $text;
        }

        $firstNul = strpos($text, "\0");

        return $firstNul === false ? $text : substr($text, 0, $firstNul);
    }

    /**
     * Octal digits, with the leading and trailing spaces and NULs tar writers leave; base-256 sizes are refused.
     *
     * @param array{int, int} $field
     */
    private static function octal(string $header, array $field): ?int
    {
        $digits = trim(self::field($header, $field, true), " \0");

        return preg_match('/^[0-7]{1,21}$/D', $digits) === 1 ? (int) octdec($digits) : null;
    }

    // The header checksum: the byte sum with the checksum field read as eight spaces.
    private static function checksum(string $header): int
    {
        $sum = 0;
        foreach (unpack('C*', $header) ?: [] as $index => $byte) {
            $inField = $index - 1 >= self::CHECKSUM[0] && $index - 1 < self::CHECKSUM[0] + self::CHECKSUM[1];
            $sum += $inField ? self::CHECKSUM_SPACE : (is_int($byte) ? $byte : 0);
        }

        return $sum;
    }
}
