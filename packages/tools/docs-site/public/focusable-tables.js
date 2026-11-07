// A table wider than the screen scrolls on its own: give it a label and a tab stop so a keyboard reaches it.
for (const table of document.querySelectorAll(".sl-markdown-content table")) {
  const section = table.closest(".sl-markdown-content");
  const headings = [...section.querySelectorAll("h2, h3, h4")];
  const before = headings.filter(
    (heading) => heading.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const nearest = before.at(-1)?.textContent.trim();

  table.setAttribute("tabindex", "0");
  table.setAttribute("role", "region");
  table.setAttribute("aria-label", nearest ? `${nearest} table` : "Table");
}
