### 7. Enums at a use

```yaml
# studio/schemas.yaml (excerpt)
DateCard:
  type: object
  required: [state]
  properties:
    state: { enum: PublicationState }
    listedState:
      enum: { narrow: PublicationState, to: [published], reason: "Drafts never reach the listing." }
```

`enum: <Name>` uses a catalogue enum (ADR 0002 section 12). `enum: { narrow, to, reason }` narrows it to a strict subset at this use, `reason` being optional docs; a `to` that is not a strict subset is an error (FR-29, SCN-080, CHK-048). A narrowing keeps the enum's identity: targets type it as the subset of the same enum, and the client keeps tolerating unknown members on output.
