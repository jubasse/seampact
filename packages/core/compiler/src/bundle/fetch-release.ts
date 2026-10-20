import { get } from "node:https";
import { BUNDLE_ARCHIVE_BYTES_MAX } from "@seampact/spec/bundle";
import type { ReleaseBundleSource } from "@seampact/spec/config";
import { quote } from "../validate/diagnostics.js";
import type { BundleSourceFailure } from "./fetch-failure.js";

// The release-asset channel: the bundle tarball downloaded over HTTPS. A bundle comes from the network, so the
// URL and every redirect must be `https:`, redirects are bounded, the download has a deadline, and it stops at the
// archive cap; the archive reader then checks the bytes.

const HTTPS_PROTOCOL = "https:";
const REDIRECTS_MAX = 5;
const DOWNLOAD_TIMEOUT_MILLISECONDS = 60_000;
const HTTP_OK = 200;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const RELEASE_FIX =
  "Check the release URL and that the asset is reachable over HTTPS, then run again.";

/** The tarball bytes the source's URL serves, or why they could not be fetched. */
export async function downloadReleaseTarball(
  source: ReleaseBundleSource,
): Promise<Uint8Array | BundleSourceFailure> {
  const url = httpsUrl(source.release.url);

  if (url === undefined)
    return {
      code: "bundle.release-url",
      message: `The release URL ${quote(source.release.url)} is not an absolute https: URL.`,
      fix: "Name the bundle tarball by its https: URL.",
    };

  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MILLISECONDS);

  return download(url, REDIRECTS_MAX, signal);
}

function httpsUrl(text: string): URL | undefined {
  if (!URL.canParse(text)) return undefined;

  const url = new URL(text);

  return url.protocol === HTTPS_PROTOCOL ? url : undefined;
}

type Download = Uint8Array | BundleSourceFailure;

function download(url: URL, redirectsLeft: number, signal: AbortSignal): Promise<Download> {
  return new Promise((settle) => {
    const request = get(url, { signal }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;

      if (REDIRECT_STATUSES.has(status) && location !== undefined) {
        response.resume();
        settle(redirected(url, location, redirectsLeft, signal));

        return;
      }

      if (status !== HTTP_OK) {
        response.resume();
        settle(releaseFailed(url, `answered HTTP ${status}`));

        return;
      }

      const chunks: Buffer[] = [];
      let received = 0;

      response.on("data", (chunk: Buffer) => {
        received += chunk.length;

        if (received > BUNDLE_ARCHIVE_BYTES_MAX) {
          request.destroy();
          settle(tooLarge(received));

          return;
        }

        chunks.push(chunk);
      });
      response.on("end", () => settle(new Uint8Array(Buffer.concat(chunks))));
      response.on("error", (error) => settle(releaseFailed(url, `failed: ${error.message}`)));
    });

    request.on("error", (error) =>
      settle(
        releaseFailed(
          url,
          signal.aborted
            ? `took over ${DOWNLOAD_TIMEOUT_MILLISECONDS} ms`
            : `failed: ${error.message}`,
        ),
      ),
    );
  });
}

function redirected(
  from: URL,
  location: string,
  redirectsLeft: number,
  signal: AbortSignal,
): Promise<Download> | Download {
  if (redirectsLeft === 0)
    return releaseFailed(from, `redirected more than ${REDIRECTS_MAX} times`);

  const target = URL.canParse(location, from.href) ? new URL(location, from) : undefined;

  if (target?.protocol !== HTTPS_PROTOCOL)
    return releaseFailed(from, `redirected to ${quote(location)}, which is not an https: URL`);

  return download(target, redirectsLeft - 1, signal);
}

function releaseFailed(url: URL, what: string): BundleSourceFailure {
  return {
    code: "bundle.release-failed",
    message: `Downloading the bundle from ${quote(url.href)} ${what}.`,
    fix: RELEASE_FIX,
  };
}

function tooLarge(received: number): BundleSourceFailure {
  return {
    code: "bundle.archive-too-large",
    message: `The release tarball holds more than ${BUNDLE_ARCHIVE_BYTES_MAX} bytes (${received} received), over the cap.`,
    fix: "Check that the source names a seampact bundle; a bundle this large is not one.",
    expected: String(BUNDLE_ARCHIVE_BYTES_MAX),
  };
}
