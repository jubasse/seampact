// A source URL as a diagnostic may print it: the user name, the password, the query and the fragment are dropped,
// since a token in them (`https://x-access-token:...@host/`, a presigned redirect) would land in CI logs. Text that
// is not an absolute URL (an scp-like git address, a path) is printed as written.

// The WHATWG parser skips leading spaces and reads `https:/` or `https:\\` as `https://`, so the text fallback does too.
const SCHEME_PREFIX = /^[\t\n\r ]*[A-Za-z][A-Za-z0-9+.-]*:/;
const AUTHORITY_SLASHES = /^[/\\]*/;
const QUERY_OR_FRAGMENT = /[?#]/;

export function printableUrl(text: string): string {
  if (!URL.canParse(text)) return SCHEME_PREFIX.test(text) ? redactedByText(text) : text;

  const url = new URL(text);

  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";

  return url.href;
}

/** A tool's error text may repeat the URL it was given; the printable form takes its place. */
export function withPrintableUrl(text: string, url: string): string {
  return text.replaceAll(url, printableUrl(url));
}

// A URL that does not parse (a bad port, a bad bracket) still may hold a token. Everything up to the last `@` goes
// first, since a password may hold a raw `?` or `#`; an `@` in the query then drops more than needed, never less.
function redactedByText(text: string): string {
  const schemeEnd = text.indexOf(":") + 1;
  const afterScheme = text.slice(schemeEnd);
  const slashes = AUTHORITY_SLASHES.exec(afterScheme)?.[0] ?? "";
  const authorityAndRest = afterScheme.slice(slashes.length);
  const withoutUser = authorityAndRest.slice(authorityAndRest.lastIndexOf("@") + 1);
  const withoutQuery = withoutUser.split(QUERY_OR_FRAGMENT, 1)[0] ?? "";

  return text.slice(0, schemeEnd).trimStart() + slashes + withoutQuery;
}
