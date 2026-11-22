//! The line ends of a text, `\r?\n` as the TypeScript's `LINE_END` reads them.

/// The first line end of `text`, `\r\n` or `\n`, and the byte offset it starts at.
pub(crate) fn first_line_end(text: &str) -> Option<(usize, &'static str)> {
    let newline = text.find('\n')?;

    if text
        .get(..newline)
        .is_some_and(|before| before.ends_with('\r'))
    {
        return Some((newline - 1, "\r\n"));
    }

    Some((newline, "\n"))
}

/// `text.split(/\r?\n/)`: each line without its end; a lone `\r` at the very end stays.
pub(crate) fn split_lines(text: &str) -> Vec<&str> {
    let mut lines: Vec<&str> = text.split('\n').collect();
    let last = lines.len().saturating_sub(1);

    for line in lines.iter_mut().take(last) {
        *line = line.strip_suffix('\r').unwrap_or(line);
    }

    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_line_end_keeps_its_carriage_return() {
        assert_eq!(first_line_end("a\r\nb\nc"), Some((1, "\r\n")));
        assert_eq!(first_line_end("a\nb\r\n"), Some((1, "\n")));
        assert_eq!(first_line_end("\r\n"), Some((0, "\r\n")));
        assert_eq!(first_line_end("a\rb"), None);
    }

    #[test]
    fn lines_split_at_each_end_and_a_trailing_carriage_return_stays() {
        assert_eq!(split_lines("a\r\nb\nc\r"), vec!["a", "b", "c\r"]);
        assert_eq!(split_lines(""), vec![""]);
        assert_eq!(split_lines("a\n"), vec!["a", ""]);
    }
}
