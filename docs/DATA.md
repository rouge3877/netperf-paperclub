# Paper data maintenance

The only maintained business data in Git is the canonical paper corpus. Each record has exactly seven fields:

```json
{
  "id": "p-unique-stable-id",
  "title": "Original English title",
  "abstract": "English abstract.",
  "authors": ["First Author", "Second Author"],
  "conference": "NSDI",
  "year": 2026,
  "url": "https://www.usenix.org/conference/nsdi26"
}
```

The sample URL illustrates the format; real records link to the actual paper's official page. Author order and original name spelling are preserved. Conference and year represent the existing collection grouping; the curated collection can contain tracks and related publication material and is not an assertion of complete proceedings coverage.

Store each record in `corpus/<lowercase-conference>/<year>/<id>.json`. Retain an existing ID when correcting title, abstract, authors or URL. New IDs must be unique; do not derive IDs again when content changes. Use UTF-8 JSON. Additions and edits should be checked against the publisher source.

Run `npm run corpus:check`, `npm test`, and `npm run build` after changes. Validation rejects extra fields, duplicate IDs, invalid source URLs, missing authors and directory/record mismatches. Startup validates the entire input before synchronizing any rows. Synchronization is transactional and leaves topics, votes, users, folders, ratings, discussions and progress intact.

Removing a source file marks its runtime record unavailable. It is excluded from new library selections but retained for existing references. This avoids silently deleting a user's reading history. Moving a record between conference/year directories requires updating those fields while retaining the ID.

## Initial topics outside Git

An optional seed file has this shape:

```json
{
  "version": 1,
  "topics": [{ "id": "networking", "name": "Networking" }],
  "papers": [{ "id": "p-existing-paper-id", "topics": ["networking"] }]
}
```

Import with `npm run topics:import -- FILE`. IDs must exist in the installed corpus. The import runs atomically and only before any topics or proposals exist. It is not a recurring synchronization mechanism. Subsequent changes require the normal majority-vote workflow.

Do not commit topic seeds, runtime databases, comments, accounts, ratings, folders, translations, source extraction archives or generated reports. SQL migrations contain schema only. Tests generate small synthetic state or read the canonical corpus rather than maintaining a second paper dataset.

## One-time migration comparison

The original checkout's English records were hashed before conversion. Verify the preserved fields with:

```sh
npm run corpus:compare -- var/migration/english-preservation.json
```

This explicit migration check requires the local reference file. It is separate from normal tests so that legitimate future paper corrections and removals do not fail against an obsolete historical snapshot. Keep the reference and pre-refactor archive for recovery; do not update them to make a migration comparison pass.
