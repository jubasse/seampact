// A table wider than its column scrolls on its own: wrap it in a labelled region with a tab stop so a keyboard
// reaches it. The table keeps its own semantics; a table that fits gets no wrapper and no tab stop.
function nearestHeadingText(section, table) {
  const headings = [...section.querySelectorAll("h2, h3, h4")];
  const before = headings.filter(
    (heading) => heading.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
  );

  return before.at(-1)?.textContent.trim();
}

function wrapInScrollRegion(table) {
  const section = table.closest(".sl-markdown-content");
  const label = nearestHeadingText(section, table);
  const region = document.createElement("div");

  region.setAttribute("role", "region");
  region.setAttribute("tabindex", "0");
  region.setAttribute("aria-label", label ? `${label} table` : "Table");
  region.style.overflowX = "auto";

  // Starlight makes the table its own scroll box; the region scrolls instead, so focus and scrolling are one element.
  table.style.overflow = "visible";
  table.before(region);
  region.append(table);
}

for (const table of document.querySelectorAll(".sl-markdown-content table")) {
  if (table.scrollWidth > table.clientWidth) wrapInScrollRegion(table);
}
