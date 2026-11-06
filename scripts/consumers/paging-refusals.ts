// The paging cases the PHP and Python consumers do not run, with the reason, which their suite refusal lists share.
// Their targets refuse the changes feed's `complete` page fact by name at generation, so the apps leave the feed's
// operations out of their tasksPaging entry; and their boundaries pass both Stripe cursors to the handler, a known bug
// whose case leaves this list with its fix.

/** The paging cases the consumer of [target], a PHP or Python server target, does not run. */
export function nativePagingRefusals(target: string): Readonly<Record<string, string>> {
  const changesFeedRefused = `${target} refuses the complete page fact by name at generation (paging.handlerResult.unsupported), so the app serves no changes feed, after 1.0`;

  return {
    "changes-since-feed-and-stale-token": changesFeedRefused,
    "limit-above-max-clamped": changesFeedRefused,
    "stripe-list-more-and-exclusive-cursors": `a known bug of ${target}: the boundary passes both the after and the before cursor to the handler instead of answering 400 (exclusiveCursors)`,
  };
}
