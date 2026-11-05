// A source URL as a diagnostic may print it: the user name, the password, the query and the fragment are dropped,
// since a token in them (`https://x-access-token:...@host/`, a presigned redirect) would land in CI logs. Text that
// is not an absolute URL (an scp-like git address, a path) is printed as written.

// The WHATWG parser reads `https:/` or `https:\\` as `https://`, so the text fallback does too.
const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const AUTHORITY_SLASHES = /^[/\\]*/;
const QUERY_OR_FRAGMENT = /[?#]/;
const TAB_OR_NEWLINE = /[\t\n\r]/g;
const LAST_CONTROL_OR_SPACE_CODE = 0x20;

export function printableUrl(text: string): string {
  if (URL.canParse(text)) return withoutUserQueryAndFragment(new URL(text));

  const parserInput = asTheUrlParserReadsIt(text);

  return SCHEME_PREFIX.test(parserInput) ? redactedByText(parserInput) : text;
}

function withoutUserQueryAndFragment(url: URL): string {
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

  return text.slice(0, schemeEnd) + slashes + withoutQuery;
}

// Before parsing, WHATWG drops every tab, CR and LF, then the C0 controls and spaces at both ends.
function asTheUrlParserReadsIt(text: string): string {
  const withoutTabsOrNewlines = text.replace(TAB_OR_NEWLINE, "");
  let start = 0;
  let end = withoutTabsOrNewlines.length;

  while (start < end && isControlOrSpace(withoutTabsOrNewlines.charCodeAt(start))) start += 1;

  while (end > start && isControlOrSpace(withoutTabsOrNewlines.charCodeAt(end - 1))) end -= 1;

  return withoutTabsOrNewlines.slice(start, end);
}

function isControlOrSpace(charCode: number): boolean {
  return charCode <= LAST_CONTROL_OR_SPACE_CODE;
}
