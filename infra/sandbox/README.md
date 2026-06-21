# Daytona Sandbox — Operator Runbook

Internal-only. All sandbox functionality is flag-gated (`AGENT_SANDBOX`). Do NOT set `AGENT_SANDBOX=1` in the production (public) deployment.

---

## How It Works

When a user's agent loop calls `run_in_sandbox`, the server creates an ephemeral Daytona workspace from the prebuilt snapshot image, executes the render command inside it, pulls the artifact bytes out over the Daytona Files API, then destroys the workspace. The bytes are uploaded to GCS under an owner-scoped key, a signed URL is generated, and an `Asset` row is written to the database. The agent loop then inserts a `media` block into the page via `apply_ops`, referencing the asset ID. The block is served to the browser via `/api/asset/[id]`, which validates ownership, generates a fresh signed URL, and redirects. No artifact bytes transit through the model. The GCS key and signed URL are opaque handles; the model sees only a `{ assetId, mime, filename }` record.

---

## Prebuilt Daytona Snapshot Image

Build a Docker image containing the following tools and register it as a Daytona snapshot. Record the snapshot name in the `STUDYOS_SANDBOX_SNAPSHOT` secret (see below).

| Tool | Purpose |
|---|---|
| `tectonic` (or TeX Live `texlive-full`) | Compile LaTeX to PDF for math/equation renders |
| `@mermaid-js/mermaid-cli` (`mmdc`) | Render Mermaid diagrams to PNG/SVG |
| `graphviz` (`dot`) | Render DOT graphs to PNG/SVG |
| `pandoc` | Document conversion, markdown to PDF via LaTeX |
| `python3` + `matplotlib` | Python-based chart/plot renders |
| `poppler-utils` | `pdftoppm` -- rasterize PDF pages to PNG |

### Recommended base Dockerfile

```dockerfile
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y \
    tectonic \
    graphviz \
    pandoc \
    python3 python3-pip \
    poppler-utils \
    nodejs npm \
    && pip3 install matplotlib \
    && npm install -g @mermaid-js/mermaid-cli \
    && apt-get clean
```

After building and publishing to your registry, register the image as a Daytona snapshot and record the snapshot name as `STUDYOS_SANDBOX_SNAPSHOT`.

---

## Required Secrets / Environment Variables (Internal Deployment Only)

Set these in the internal Cloud Run service (never in the public production service):

| Variable | Description |
|---|---|
| `AGENT_SANDBOX` | Set to `1` to enable sandbox execution. Must be unset or `0` in production. |
| `AUTHENTIC_AGENT` | Set to `1` to enable the authentic agent loop (required alongside `AGENT_SANDBOX`). |
| `DAYTONA_API_KEY` | API key for the Daytona cloud workspace service. |
| `STUDYOS_SANDBOX_SNAPSHOT` | Name/ID of the prebuilt Daytona snapshot image to use for workspaces. |
| `ASSETS_BUCKET` | GCS bucket name where artifacts are stored (e.g. `studyos-sandbox-assets`). |
| `GCS_SERVICE_ACCOUNT_KEY` | JSON key for the GCS service account with `storage.objects.create` and `storage.objects.get` on `ASSETS_BUCKET`. |

**Production guard:** Confirm `AGENT_SANDBOX` is absent or `0` in the public Cloud Run service before any rollout. The sandbox routes and tool definitions are entirely suppressed when the flag is off.

---

## DEFERRED Manual Steps (Human Checklist)

The following steps are NOT automated. A human operator must complete them before any internal smoke testing can proceed.

- [ ] **(a) Apply the Asset migration to Neon**
  Run `prisma migrate deploy` against the Neon database (per repo policy -- never `migrate dev` on shared databases). This applies the `Asset` table migration created in this branch. Verify the `Asset` table exists in the Neon console after running.

- [ ] **(b) Provision the GCS bucket and IAM**
  Create the GCS bucket named in `ASSETS_BUCKET`. Grant the service account (referenced by `GCS_SERVICE_ACCOUNT_KEY`) the `Storage Object Admin` role on that bucket (or at minimum `storage.objects.create`, `storage.objects.get`, and `storage.objects.delete`). Verify signed-URL generation works from both the Vercel and Cloud Run deployments.

- [ ] **(c) Build and publish the Daytona snapshot image**
  Build the Dockerfile above (or equivalent), push to a registry accessible by Daytona, register it as a Daytona snapshot, and record the snapshot name in `STUDYOS_SANDBOX_SNAPSHOT`.

- [ ] **(d) Run the live smoke test and capture cost metrics**
  In the internal environment (with all secrets set and `AGENT_SANDBOX=1`), send the agent the prompt: "render the quadratic formula as an image."
  Confirm:
  - A `media` block appears on the page with the rendered image.
  - The image loads successfully via `/api/asset/:id` (check the network tab -- should be a 302 redirect to a signed GCS URL).
  - **Capture and record here:** the Daytona sandbox-seconds consumed and the run count for one render. This cost number is the empirical gate for any public rollout decision.

  > **Record results here:**
  > - Sandbox-seconds per render: _____________
  > - Daytona run count per render: _____________
  > - Image loaded correctly: [ ] yes / [ ] no
  > - Notes: _____________

- [ ] **(e) Confirm Undo removes the media block**
  After the `media` block appears, invoke Undo (Ctrl+Z or the UI button). Confirm the block is removed from the page and the Asset record is cleaned up (or left as an orphan per the chosen GC policy). This is the Undo regression gate.

---

## Notes

- Concurrency caps (1 sandbox/user, daily quota) are not yet implemented. For the internal single-operator deployment this is acceptable; the existing `AgentTask` limits bound active tasks per user to 1. Flag this for the public-rollout follow-up before any general availability.
- Sandboxes are ephemeral: create then run then pull artifact then destroy. An auto-stop backstop timeout is set on each workspace to prevent runaway cost if the destroy call is missed.
- Artifact bytes never transit through the model. The model receives only `{ assetId, mime, filename }` after the sandbox run completes.
