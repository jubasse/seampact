# 5. Run it

Start the app from the app folder.

```sh
npx tsx src/main.ts
```

In another terminal, create a note.

```sh
curl -i -X POST localhost:3000/v1/notes -H 'content-type: application/json' -d '{"title":"Buy milk"}'
```

You see `201` and the note with its `noteId`. `curl localhost:3000/v1/notes` lists it.

Send an empty title.

```sh
curl -i -X POST localhost:3000/v1/notes -H 'content-type: application/json' -d '{"title":""}'
```

You see `400` and a `application/problem+json` body whose `issues` names `/title`.

Next: [6. Check a change](6-check-a-change.md)
