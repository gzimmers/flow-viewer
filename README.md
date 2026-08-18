# Flow Viewer

A local developer tool for **execution Flows** — structured, versioned, navigable
descriptions of how a codebase actually behaves, published by coding agents and
read by humans.

The central experience:

```
Developer asks a coding agent to investigate something
        ↓
Agent explores the repository
        ↓
Agent publishes a structured Flow (POST /api/flows)
        ↓
Developer opens the Flow
        ↓
Developer traverses the execution path across many files —
always reading COMPLETE source files, with the relevant
regions marked and synchronized to the Flow
        ↓
Revisit the Flow days or months later
```

Flows are deterministic data after publishing: no LLM in the read path, no
snippets, no "… show more". The source editor always shows the full file.

---

## Quick start

Requirements: **Node.js >= 22.5** (uses the built-in `node:sqlite` module; the
repo passes `--experimental-sqlite` automatically).

```bash
npm install          # installs server + web workspaces
npm run dev          # starts API (http://localhost:4000) + web (http://localhost:5173)
```

Open **http://localhost:5173** — the library loads with three seeded demo flows.
The demo database is created and seeded automatically on first run.

Useful scripts (from the repo root):

| Script              | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `npm run dev`       | API + Vite dev server with hot reload, prefixed output              |
| `npm run build`     | Build the web bundle into `web/dist`                                |
| `npm start`         | Production mode: one process on **:4000** serving API + web bundle  |
| `npm run seed`      | (Re)seed demo data — add `--force` via `npm run reseed` to wipe     |
| `npm run typecheck` | Typecheck both workspaces                                           |
| `npm run example`   | Regenerate `server/examples/publish-create-exporter.json`           |

> Production mode: `npm run build && npm start`, then open http://localhost:4000.

---

## Seeded demo data

Repository `acme/exporter-service` (Java) with three flows:

**Create Exporter** (HTTP) — `POST /exporters`. 19 nodes / 18 edges across 10
files. Exercises everything:

- `ExporterManager.java` is a complete **1059-line file** with three flow
  regions pinned to exact lines: `validateMode()` **100–140**, `create()`
  **640–690**, `persist()` **810–840** (plus a nested single-line branch at 651)
- a **branch** (mode valid/invalid) and an existence branch (new/exists)
- an **async boundary**: `ExporterCommandPublisher.publish()` →
  `ExporterCommandConsumer.onMessage()` (purple dashed edge, labeled
  `ASYNC · kafka: exporter-commands`)
- first-class **exits**: 201, 400, 409, 422, 500 — each mapped from its
  exception via `ExporterExceptionMapper`
- error edges from domain exceptions to their exit statuses

**Exporter Startup** (startup) — process bootstrap, all-or-nothing, with
`exit 0` / `exit 1` exits and a failed-step branch.

**Schema Processing Loop** (async) — Kafka consumer loop: decode →
compatibility check (branch) → register / dead-letter.

Collections: *Exporters*, *Schema Lifecycle*, *Service Lifecycle*.

### "Open Flow (Self)" — a flow about this app itself

`server/examples/publish-self-flow.json` describes flow-viewer's own
*open-a-flow* execution path across 9 TypeScript files of this repository:
Library click → Router → Workspace effect → `fetch` → Express route → SQLite
queries → back to the client where the Monaco editor mounts, text models are
created, region decorations are applied, and the entry region is revealed.
It includes two async edges (the HTTP round trip), a nested region in
`Workspace.tsx`, and OK / 404 / 500 exits.

```bash
npm run self-flow    # regenerate the payload from the current sources
curl -X POST -H "Content-Type: application/json" \
  -d @server/examples/publish-self-flow.json http://localhost:4000/api/flows
```

Publishing it is the canonical end-to-end test of the agent contract. Because
a flow is a versioned snapshot, re-run `npm run self-flow` and publish a new
version (`POST /api/flows/:id/versions`) after the sources change.

---

## Keyboard

Workspace (editor focused or not):

| Keys                          | Action                                    |
| ----------------------------- | ----------------------------------------- |
| `Alt` + `↓` / `Alt` + `↑`     | Next / previous flow region               |
| `Ctrl` + `Shift` + `←` / `→`  | Back / forward in navigation history      |
| `g`                           | Toggle Editor / Graph view                |
| `Esc`                         | Clear exit-path filter                    |

Clicking a **flow-aware link** (dashed underline on a call inside the active
region) navigates to the target node's file and region.

---

## The agent publish contract

Agents publish Flows with **one HTTP call**. The payload contains everything:
repository reference, complete source files, nodes (regions), edges.

```bash
curl -X POST -H "Content-Type: application/json" \
  -d @server/examples/publish-create-exporter.json \
  http://localhost:4000/api/flows
```

The Flow is immediately available in the library and fully navigable — no app
code changes. The example file is a real, working 106 KB payload (regenerate
with `npm run example`).

### Payload shape

```jsonc
{
  "name": "Create Exporter",            // required
  "description": "Synchronous HTTP creation path…",
  "type": "http",                       // http | startup | async | job | other
  "branch": "main",
  "tags": ["http", "exporter", "async"],
  "repository": {                       // required
    "name": "acme/exporter-service",
    "url": "git@example.com:acme/exporter-service.git",
    "defaultBranch": "main"
  },
  "files": [                            // complete sources, not snippets
    { "path": "src/.../ExporterResource.java", "language": "java", "content": "package …" }
  ],
  "nodes": [
    {
      "key": "entry",                   // stable id, referenced by edges
      "sortOrder": 1,                   // execution order (auto = array order)
      "kind": "entry",                  // entry | call | branch | async | exit
      "label": "POST /exporters",
      "symbol": "createExporter",       // optional; used for flow-aware links
      "file": "src/.../ExporterResource.java",
      "startLine": 49,                  // 1-based inclusive
      "endLine": 55,
      "exitStatus": null,               // for kind=exit: "201", "422", "OK", …
      "exitLabel": null,                // "201 Created"
      "meta": {}                        // free-form (protocol, handler, …)
    }
  ],
  "edges": [
    { "from": "entry", "to": "parse",  "kind": "sync" },
    { "from": "publish", "to": "consume", "kind": "async", "label": "kafka: exporter-commands" },
    { "from": "validate", "to": "existsCheck", "kind": "branch", "label": "valid" }
    // kind: sync | async | branch | error
  ]
}
```

Validation rules: `nodes` required (≥1), unique `key`s, valid kinds, edge
endpoints must reference known keys, `node.file` must exist in `files` (or
already in the repository), line ranges must be ordered. Errors return
`400 { "error": "…" }`.

### REST API summary

| Method & path                          | Description                                          |
| -------------------------------------- | ---------------------------------------------------- |
| `GET /api/health`                      | Health + flow count                                  |
| `GET /api/flows`                       | List. Query: `q` (name/desc/label/symbol/path), `type`, `repo`, `branch`, `tag`, `favorite`, `archived` |
| `POST /api/flows`                      | Publish a new flow (v1) — the agent contract         |
| `GET /api/flows/:id`                   | Full flow: meta + nodes + edges + complete files (`?version=N`) |
| `PATCH /api/flows/:id`                 | Update `name`, `description`, `type`, `branch`, `isFavorite`, `isArchived`, `tags` |
| `DELETE /api/flows/:id`                | Delete flow (cascades versions/nodes/edges)          |
| `GET /api/flows/:id/versions`          | Version history                                      |
| `GET /api/flows/:id/versions/:v`       | Flow graph at a specific version                     |
| `POST /api/flows/:id/versions`         | Publish a new version of an existing flow            |
| `GET /api/files/:id`                   | One complete file                                    |
| `GET /api/files?repository=&path=`     | File by repo+path                                    |
| `GET /api/repositories`                | Repos with file/flow counts                          |
| `GET /api/tags`                        | Tags with flow counts                                |
| `GET /api/collections`                 | Collections with items                               |
| `POST /api/collections`                | Create collection `{ name, description? }`           |
| `PUT /api/collections/:id/items`       | Replace items (array of flow ids)                    |
| `DELETE /api/collections/:id`          | Delete collection                                    |

---

## Architecture

```
flow-viewer/
├── dev.mjs                  # runs server + web with prefixed output
├── server/
│   ├── src/
│   │   ├── index.ts         # Express bootstrap, static SPA, first-run seed
│   │   ├── db.ts            # node:sqlite connection + schema
│   │   ├── types.ts         # wire types (publish contract)
│   │   ├── publish.ts       # payload validation + write (API and seed share it)
│   │   ├── queries.ts       # list/detail/collection queries
│   │   ├── routes.ts        # REST routes
│   │   ├── seed-cli.ts      # npm run seed [--force]
│   │   ├── make-example.ts  # emits the example agent payload
│   │   └── seed/
│   │       ├── data.ts      # the 3 demo flows, in publish-payload shape
│   │       ├── java-files.ts# complete Java sources (demo repo)
│   │       ├── exporter-manager.ts  # 1059-line file, regions pinned to lines
│   │       └── regions.ts   # anchor-based region computation
│   └── examples/publish-create-exporter.json
└── web/
    └── src/
        ├── App.tsx          # hash routing: / (library), /flow/:id (workspace)
        ├── api.ts           # typed API client
        ├── types.ts
        ├── monaco-setup.ts  # Monaco workers
        ├── themes.ts        # flow-dark / flow-light Monaco themes
        ├── lib/
        │   ├── flow.ts      # ordering, exit tones, backward reachability
        │   ├── graph.ts     # layered graph layout
        │   └── decorations.ts # region + link decoration builder
        └── components/
            ├── Library.tsx      # home: search, filters, collections, tags
            ├── Workspace.tsx    # state: navigation, history, exit filter
            ├── FlowHeader.tsx   # title, search, view toggle
            ├── PathStrip.tsx    # ordered step pills + exit chips
            ├── Navigator.tsx    # files → regions tree
            ├── SourceView.tsx   # Monaco: full files, tabs, markers, links
            ├── GraphView.tsx    # SVG graph: branches, async edges, pan/zoom
            └── StatusLine.tsx   # file, step x/y, filter state, theme
```

**Database** — SQLite (`server/data/flow-viewer.db`), relational:
`repositories`, `files` (full content), `flows`, `flow_versions`, `nodes`,
`edges`, `tags`, `flow_tags`, `collections`, `collection_items`. Core
relationships are queryable; only free-form `node.meta` is JSON.

**Design notes**

- The seed uses the *same* `publishFlow()` code path as the API — the demo
  flows are exactly what an agent would publish.
- Node identity is `flow + version + key`; source references are
  `file + line range` (with symbol hints for links) — not line numbers alone.
- Exit-path filtering is client-side backward reachability over edges, so it
  is instant and works for any exit status (HTTP codes, `OK`/`FAIL`, `DLQ`).
- Monaco keeps one model per open file; regions are decorations (background +
  border + glyph margin + overview ruler), so surrounding code is untouched
  and always scrollable.

---

## Acceptance workflows (manual test guide)

1. **Full-file navigation** — open *Create Exporter*, click step 4
   (`ExporterManager.create()`). The full 1059-line file opens, the editor
   centers on line 640, lines 640–690 are marked (blue border + glyph + ruler
   tick), and everything else is intact.
2. **Multiple regions in one file** — the overview ruler of
   `ExporterManager.java` shows ticks at 100–140, 640–690 and 810–840 (plus
   the nested branch at 651). Selecting any one makes it the strongest marker.
3. **Multi-file traversal** — press `Alt+↓` repeatedly: 19 regions across 10
   files; each transition opens the target file, reveals the region, updates
   the path strip and navigator.
4. **History** — walk `ExporterResource → ExporterManager → KafkaExporterStore`,
   then `Ctrl+Shift+←` twice: exact previous files and regions restored.
5. **Exit filtering** — click the **422 Invalid State** chip in the path strip:
   only the nodes/edges that can reach 422 stay lit (path strip, navigator,
   graph all dim the rest); navigation still works everywhere. `Esc` clears.
6. **Branches** — Graph view (`g`): `validateMode` and the exists-check are
   diamonds with labeled `valid`/`invalid` / `new`/`exists` edges.
7. **Async boundary** — the edge `publish → consume` is purple, dashed, and
   labeled `ASYNC · kafka: exporter-commands`; async nodes carry a purple
   accent.
8. **Agent-created flow** — `POST /api/flows` with the example payload → new
   flow appears in the library instantly and navigates identically.
