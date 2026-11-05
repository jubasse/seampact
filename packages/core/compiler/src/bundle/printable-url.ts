// A source URL as a diagnostic may print it: the user name, the password, the query and the fragment are dropped,
// since a token in them (`https://x-access-token:...@host/`, a presigned redirect) would land in CI logs. Text that
// is not an absolute URL (an scp-like git address, a path) is printed as written.

const SCHEME_SEPARATOR = "://";
const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

export function printableUrl(text: string): string {
  if (!URL.canParse(text)) return SCHEME_PREFIX.test(text) ? redactedByText(text) : text;

  const url = new URL(text);

  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";

  return url.href;
}

// A URL that does not parse (a bad port, a bad bracket) still may hold a token: drop the query, the fragment, and
// everything from the scheme's `//` to the last `@`, by text.
function redactedByText(text: string): string {
  const schemeEnd = text.indexOf(SCHEME_SEPARATOR) + SCHEME_SEPARATOR.length;
  const withoutQuery = text.slice(schemeEnd).split(/[?#]/, 1)[0] ?? "";
  const withoutUser = withoutQuery.slice(withoutQuery.lastIndexOf("@") + 1);

  return text.slice(0, schemeEnd) + withoutUser;
}
