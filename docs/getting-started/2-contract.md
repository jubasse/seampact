# 2. Write the contract

The contract describes one collection, `notes`, with four operations. Run the commands in the app folder. Create `contract/api.yaml`.

```yaml
api:
  name: notes
  version: 1
  kind: product
  maturity: provisional
  summary: A small notes api.

pagings:
  cursor:
    request:
      cursor: { query: cursor }
      limit: { query: limit }
    response:
      body: $items
      links: { next: $next }

schemas:
  NoteId: { type: string, format: uuid }
  Note:
    type: object
    required: [noteId, title, createdAt]
    properties:
      noteId: NoteId
      title: { type: string, minLength: 1, maxLength: 100 }
      body: { type: string, maxLength: 2000 }
      createdAt: { type: string, format: date-time }
  CreateNote:
    type: object
    required: [title]
    properties:
      title: { type: string, minLength: 1, maxLength: 100 }
      body: { type: string, maxLength: 2000 }

surfaces:
  app:
    prefix: /v{version}
    access: { public: "Anyone may call this api: it has no accounts." }
    routes:
      notes:
        kind: collection
        id: { noteId: NoteId }
        item: Note
        ops:
          list: { paging: { cursor: { maxLimit: 50 } } }
          get: {}
          create: { input: CreateNote }
          delete: {}
```

A contract with one api needs no `workspace.yaml`: seampact reads `api.yaml` in the folder. A list must name its paging style, and `access` says who may call the routes.

Check it.

```sh
npx seampact lint
```

You see `Linted 1 api(s): 0 error(s), 0 warning(s).`

Next: [3. Generate the code](3-generate.md)
