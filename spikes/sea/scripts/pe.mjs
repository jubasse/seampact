// PE (Windows executable) helpers: the Authenticode signature of the official node.exe is
// removed before the SEA injection (it cannot stay valid once the image changes).
// Usage: node scripts/pe.mjs check <file.exe>   exits 1 if the PE security directory is not empty.
import { readFileSync, truncateSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function layout(buf) {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x00004550) throw new Error("not a PE file");
  const opt = pe + 24;
  const magic = buf.readUInt16LE(opt);
  if (magic !== 0x20b && magic !== 0x10b) throw new Error(`unknown optional header ${magic}`);
  const dirs = opt + (magic === 0x20b ? 112 : 96);
  return { checksum: opt + 64, security: dirs + 4 * 8 };
}

// Returns { offset, size } of the certificate table (both 0 when there is none).
export function securityDirectory(file) {
  const buf = readFileSync(file);
  const { security } = layout(buf);
  return { offset: buf.readUInt32LE(security), size: buf.readUInt32LE(security + 4) };
}

// Removes the certificate table (a file offset, not an RVA, at the end of the file), clears the
// directory entry and the checksum. Returns the number of bytes removed.
export function stripSignature(file) {
  const buf = readFileSync(file);
  const { checksum, security } = layout(buf);
  const offset = buf.readUInt32LE(security);
  const size = buf.readUInt32LE(security + 4);
  if (offset === 0 && size === 0) return 0;
  if (offset + size !== buf.length) {
    throw new Error(`certificate table (${offset}+${size}) does not end the file (${buf.length})`);
  }
  buf.writeUInt32LE(0, security);
  buf.writeUInt32LE(0, security + 4);
  buf.writeUInt32LE(0, checksum);
  writeFileSync(file, buf.subarray(0, offset));
  truncateSync(file, offset);
  return size;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd !== "check" || !file) {
    console.error("usage: pe.mjs check <file.exe>");
    process.exit(2);
  }
  const { offset, size } = securityDirectory(file);
  console.log(`pe: security directory offset ${offset}, size ${size}`);
  process.exit(offset === 0 && size === 0 ? 0 : 1);
}
