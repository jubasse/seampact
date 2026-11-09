### Paged lists

The infinite query starts from the request's own position, and its next page's request sets the paging style's position role (`cursor`, `after`, `page` or `offset`, in the query or a header, grammar section 14) from the page facts the client read: `nextCursor`; the page, or the offset plus the limit, when `more` is true, when the page is below `totalPages`, when `total` with the limit says records follow, or when a `next` link is present; or the position parameter of the `next` link itself. No next fact ends the list. The pages are not flattened, since the shape is the app's; the opt-in artefact `itemsOf` exports `itemsOf(pages)`.

A `since` style, and a style whose facts give no next position, get no infinite query: `generate` warns by name (`paging.infinite.skipped`), with the operation and the reason, and the plain query stays. `infinite: off` generates no infinite query at all.
