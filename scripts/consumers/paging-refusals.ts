// The paging cases the PHP and Python consumers do not run, with the reason, which their suite refusal lists share.
// Their targets refuse the changes feed's `complete` page fact by name at generation, so the apps leave the feed's
// operations out of their tasksPaging entry.

/** The paging cases the consumer of [target], a PHP or Python server target, does not run. */
export function nativePagingRefusals(target: string): Readonly<Record<string, string>> {
  const changesFeedRefused = `${target} refuses the complete page fact by name at generation (paging.handlerResult.unsupported), so the app serves no changes feed, after 1.0`;

  return {
    "changes-since-feed-and-stale-token": changesFeedRefused,
  };
}
