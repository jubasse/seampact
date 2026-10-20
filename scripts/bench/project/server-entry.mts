// Starts one server of a pair in this process and answers the parent over IPC: `ready` with its base URL, then
// the process memory on request, with the peak since the last reset sampled every 250 ms, its CPU time, its memory
// after a forced GC (started with `--expose-gc`), and a CPU profile of the window between `profile-start` and
// `profile-stop`.
// usage: node --import tsx bench/server-entry.mts <seampact|baseline> <framework>
import { readFile, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";

const SAMPLE_INTERVAL_MS = 250;
const PROFILE_INTERVAL_MICROSECONDS = 200;
const KIB = 1024;
// The resident anonymous memory of this process, in kB, as Linux reports it.
const ANONYMOUS_RSS_LINE = /^RssAnon:\s+(\d+) kB$/m;
const [kind, framework] = process.argv.slice(2);

interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

async function startChosenServer(): Promise<RunningServer> {
  if (kind === "seampact") return (await import("../test/server.mjs")).startServer();

  if (kind === "baseline")
    return (await import(`./baselines/${framework}/server.mjs`)).startServer();

  throw new Error(`bench: server-entry takes 'seampact' or 'baseline', not '${kind}'.`);
}

if (process.send === undefined) {
  throw new Error("bench: server-entry runs as a forked child with an IPC channel.");
}

const send = process.send.bind(process);
let peak = { rss: 0, heapUsed: 0 };

function sample(): { rss: number; heapUsed: number } {
  const { rss, heapUsed } = process.memoryUsage();

  peak = { rss: Math.max(peak.rss, rss), heapUsed: Math.max(peak.heapUsed, heapUsed) };

  return { rss, heapUsed };
}

const server = await startChosenServer();

setInterval(sample, SAMPLE_INTERVAL_MS).unref();

const profiler = new Session();

profiler.connect();

async function startProfile(): Promise<void> {
  await profiler.post("Profiler.enable");
  await profiler.post("Profiler.setSamplingInterval", { interval: PROFILE_INTERVAL_MICROSECONDS });
  await profiler.post("Profiler.start");
}

async function stopProfile(file: string): Promise<void> {
  const { profile } = await profiler.post("Profiler.stop");

  await writeFile(file, JSON.stringify(profile));
}

// The memory left once a full GC ran: what the server keeps, apart from what it has not yet collected.
async function settledMemory(): Promise<object> {
  const collect: unknown = Reflect.get(globalThis, "gc");

  if (typeof collect !== "function") {
    throw new Error("bench: a settled memory reading needs the server started with --expose-gc.");
  }

  collect();

  const { rss, heapUsed, heapTotal } = process.memoryUsage();

  return { rss, heapUsed, heapTotal, anonymousRss: await anonymousRss() };
}

async function anonymousRss(): Promise<number> {
  const status = await readFile("/proc/self/status", "utf8").catch((error: unknown) => {
    throw new Error(
      `bench: the off-heap reading needs Linux's /proc/self/status (${String(error)}); run --memory on Linux.`,
    );
  });
  const kibibytes = ANONYMOUS_RSS_LINE.exec(status)?.[1];

  if (kibibytes === undefined) throw new Error("bench: /proc/self/status has no RssAnon line.");

  return Number(kibibytes) * KIB;
}

process.on("message", async (message: { type: string; file?: string }) => {
  if (message.type === "profile-start") {
    await startProfile();
    send({ type: "profile-started" });

    return;
  }

  if (message.type === "profile-stop" && message.file !== undefined) {
    await stopProfile(message.file);
    send({ type: "profile-written", file: message.file });

    return;
  }

  if (message.type === "memory-reset") {
    peak = { rss: 0, heapUsed: 0 };
    sample();

    return;
  }

  if (message.type === "memory-read") {
    const current = sample();

    send({ type: "memory", ...current, peakRss: peak.rss, peakHeapUsed: peak.heapUsed });

    return;
  }

  if (message.type === "cpu-read") {
    const { user, system } = process.cpuUsage();

    send({ type: "cpu", microseconds: user + system });

    return;
  }

  if (message.type === "settled-memory-read") {
    send({ type: "settled-memory", ...(await settledMemory()) });

    return;
  }

  if (message.type === "shutdown") {
    await server.close();
    process.exit(0);
  }
});

send({ type: "ready", baseUrl: server.baseUrl });
