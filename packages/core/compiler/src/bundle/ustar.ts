// The ustar header layout (POSIX.1-1988) the bundle tarball writer and reader share: field offsets and lengths,
// the block size and the header checksum.

export const USTAR_BLOCK_BYTES = 512;

export interface UstarField {
  readonly offset: number;
  readonly length: number;
}

export const USTAR_FIELDS = {
  name: { offset: 0, length: 100 },
  mode: { offset: 100, length: 8 },
  uid: { offset: 108, length: 8 },
  gid: { offset: 116, length: 8 },
  size: { offset: 124, length: 12 },
  mtime: { offset: 136, length: 12 },
  checksum: { offset: 148, length: 8 },
  type: { offset: 156, length: 1 },
  linkName: { offset: 157, length: 100 },
  magic: { offset: 257, length: 6 },
  version: { offset: 263, length: 2 },
  userName: { offset: 265, length: 32 },
  groupName: { offset: 297, length: 32 },
  deviceMajor: { offset: 329, length: 8 },
  deviceMinor: { offset: 337, length: 8 },
  prefix: { offset: 345, length: 155 },
} as const satisfies Record<string, UstarField>;

export const USTAR_MAGIC = "ustar\0";
export const USTAR_VERSION = "00";
// GNU tar's magic and version, one 8-byte field: read like ustar's, since its regular and directory entries agree.
export const GNU_MAGIC_AND_VERSION = "ustar  \0";

export const USTAR_TYPE_FILE = "0";
// Pre-POSIX archives mark a regular file with a NUL type.
export const USTAR_TYPE_FILE_OLD = "\0";
export const USTAR_TYPE_DIRECTORY = "5";
export const PAX_TYPE_EXTENDED = "x";
export const PAX_TYPE_GLOBAL = "g";

/** The header checksum: the byte sum with the checksum field read as eight spaces. */
export function ustarChecksum(header: Uint8Array): number {
  const { offset, length } = USTAR_FIELDS.checksum;
  const SPACE = 0x20;
  let sum = 0;

  for (let index = 0; index < USTAR_BLOCK_BYTES; index++)
    sum += index >= offset && index < offset + length ? SPACE : (header[index] ?? 0);

  return sum;
}

/** The bytes a block-aligned record of `size` bytes takes. */
export function ustarPadded(size: number): number {
  return Math.ceil(size / USTAR_BLOCK_BYTES) * USTAR_BLOCK_BYTES;
}

/** Where a path is split into the prefix and name fields, or undefined when it does not fit them. */
export function ustarPathSplit(path: string): { prefix: string; name: string } | undefined {
  if (path.length <= USTAR_FIELDS.name.length) return { prefix: "", name: path };

  for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
    const prefix = path.slice(0, slash);
    const name = path.slice(slash + 1);

    if (
      prefix.length <= USTAR_FIELDS.prefix.length &&
      name.length <= USTAR_FIELDS.name.length &&
      name !== ""
    )
      return { prefix, name };
  }

  return undefined;
}
