// A source URL as a diagnostic may print it: the user name, the password, the query and the fragment are dropped,
// since a token in them (`https://x-access-token:...@host/`, a presigned redirect) would land in CI logs. Text that
// is not an absolute URL (an scp-like git address, a path) is printed as written.

export function printableUrl(text: string): string {
  if (!URL.canParse(text)) return text;

  const url = new URL(text);

  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";

  return url.href;
}
