// PE (Windows executable) helpers: the Authenticode signature of the official node.exe is
// removed before the SEA injection (it cannot stay valid once the image changes).
// Usage: node scripts/pe.mjs check <file.exe>   exits 1 if the PE security directory is not empty.
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function layout(buf) {
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) throw new Error("not a PE file (no MZ)");
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 24 > buf.length || buf.readUInt32LE(pe) !== 0x00004550) throw new Error("not a PE file");
  const sections = buf.readUInt16LE(pe + 6);
  const optSize = buf.readUInt16LE(pe + 20);
  const opt = pe + 24;
  const magic = buf.readUInt16LE(opt);
  if (magic !== 0x20b && magic !== 0x10b) throw new Error(`unknown optional header ${magic}`);
  const count = buf.readUInt32LE(opt + (magic === 0x20b ? 108 : 92));
  if (count < 5) throw new Error(`NumberOfRvaAndSizes ${count} has no security directory`);
  const dirs = opt + (magic === 0x20b ? 112 : 96);
  const table = opt + optSize;
  if (dirs + count * 8 > opt + optSize || table + sections * 40 > buf.length) {
    throw new Error("PE headers are truncated or inconsistent");
  }
  let dataEnd = 0;
  for (let i = 0; i < sections; i++) {
    const at = table + i * 40;
    dataEnd = Math.max(dataEnd, buf.readUInt32LE(at + 20) + buf.readUInt32LE(at + 16));
  }
  return { checksum: opt + 64, security: dirs + 4 * 8, dataEnd };
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
  const { checksum, security, dataEnd } = layout(buf);
  const offset = buf.readUInt32LE(security);
  const size = buf.readUInt32LE(security + 4);
  if (offset === 0 && size === 0) return 0;
  if (offset + size !== buf.length) {
    throw new Error(`certificate table (${offset}+${size}) does not end the file (${buf.length})`);
  }
  if (offset < dataEnd) {
    throw new Error(
      `certificate table starts at ${offset}, inside section data (ends at ${dataEnd})`,
    );
  }
  buf.writeUInt32LE(0, security);
  buf.writeUInt32LE(0, security + 4);
  // The checksum is zeroed, not recomputed: user-mode executables do not need it.
  buf.writeUInt32LE(0, checksum);
  writeFileSync(file, buf.subarray(0, offset));
  return size;
}

const sameFile = (a, b) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};

if (process.argv[1] && sameFile(process.argv[1], fileURLToPath(import.meta.url))) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd !== "check" || !file) {
    console.error("usage: pe.mjs check <file.exe>");
    process.exit(2);
  }
  const { offset, size } = securityDirectory(file);
  console.log(`pe: security directory offset ${offset}, size ${size}`);
  process.exit(offset === 0 && size === 0 ? 0 : 1);
}
