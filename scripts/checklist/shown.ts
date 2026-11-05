const SHOWN_VALUE_LENGTH = 40;

/**
 * A value read from a report or a fetched result, or any text taken from one, as one quoted token that is safe to
 * print in a job log and a markdown fence: cut short, with line breaks and backticks escaped, so it cannot start a
 * workflow command.
 */
export function shown(value: unknown): string {
  const text = String(value);
  const cut = text.length > SHOWN_VALUE_LENGTH ? `${text.slice(0, SHOWN_VALUE_LENGTH)}...` : text;

  return JSON.stringify(cut).replaceAll("`", "\\u0060");
}
