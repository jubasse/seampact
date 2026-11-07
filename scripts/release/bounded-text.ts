// Text from outside the run (a remote's stderr, an index's file names) cut to a length an error message can carry.
const ELLIPSIS = "...";

/** The text, or its first `maxLength` characters followed by the count of the ones cut. */
export function boundedText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  return `${text.slice(0, maxLength)}${ELLIPSIS} (${text.length - maxLength} more characters)`;
}
