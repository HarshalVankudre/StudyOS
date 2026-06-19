# Agent Sandbox — provisioning runbook (Increment B)

> Operational companion to `docs/superpowers/plans/2026-06-19-agent-sandbox-execution.md`.
> Everything here **provisions paid GCP infrastructure and changes security-critical
> network config**. Do not run it without an explicit decision on cost and rollout.
> Project `pacific-song-485904-g1`, region `us-east4` (matches the app + the
> `studyos-deploy` trigger).

## Status

- ✅ Shipped (Increment A + B-foundation, no infra): result-size caps, durable
  cancelable tasks, tool/skill registry, SSRF-hardened controlled fetch, and the
  sandbox **trust boundary** code — `src/lib/ai/sandbox/snapshot.ts`
  (outbound, owner-scoped, validated) and `src/lib/ai/sandbox/result.ts`
  (inbound, byte-capped + `agentOpsSchema`-validated). Flag `AGENT_SANDBOX` is
  **off** (`src/lib/flags.ts`).
- ⛔ Not provisioned: the runner image/Job, the zero-role SA, the VPC egress
  jail, Cloud Tasks. Below is the gated runbook.

## Cost before you start

- Egress proxy / Cloud NAT is a **standing** cost (~tens of USD/month), independent
  of task volume. Per-task Job compute is a fraction of a cent. Decide whether
  web-reading tasks justify the proxy, or disable egress entirely (most edit-only
  tasks need none) and add it later.

## 1. Identity (zero-role runner SA)

```bash
gcloud iam service-accounts create studyos-sandbox-runner \
  --display-name="StudyOS agent sandbox runner (no roles)"
# Grant NOTHING: no Secret Manager, no Cloud SQL/Neon, no run.developer, no
# artifactregistry.writer. The box must have no path to secrets or the DB.
# Allow the MAIN service account to run the Job + mint signed URLs + read executions:
#   roles/run.developer (scoped to the Job), roles/iam.serviceAccountTokenCreator,
#   storage object admin on ONE task-bucket prefix.
```

## 2. Network jail (the keystone — verify before any rollout)

```bash
# Dedicated subnet with NO default internet route; Direct VPC egress all-traffic
# on the Job; a single forward proxy holds the host allowlist, is
# response-read-only (blocks request bodies), and DENIES:
#   - 169.254.169.254 and metadata.google.internal  (SA-token theft)
#   - all RFC1918 / loopback / link-local             (internal services, Neon)
# VPC firewall egress: allow ONLY the proxy ip:port. Add a deploy-time assertion
# that --vpc-egress=all-traffic (flipping to private-ranges silently reopens the
# internet via Google's default path).
```

### BLOCKING verification (do this first, record the output here)

From inside a deployed Job execution, all of these must FAIL, and an allowlisted
host must succeed GET-only:

```bash
curl -sS -m 5 http://169.254.169.254/computeMetadata/v1/ -H "Metadata-Flavor: Google"   # must FAIL
curl -sS -m 5 http://metadata.google.internal/                                            # must FAIL
curl -sS -m 5 https://10.0.0.1/ ; curl -sS -m 5 https://192.168.0.1/                      # must FAIL
curl -sS -m 5 https://example.com/  # (only if allowlisted) must succeed, GET only
```

Link-local traffic is frequently not routed off-host, so the firewall may never
see the metadata request — **prove the block empirically; do not assume it.**
Until this passes, the sandbox path stays behind `AGENT_SANDBOX=off`.

## 3. Runner image + Job

- A minimal Node image (`Dockerfile.runner`, TBD) containing ONLY the tool
  handlers (fs/shell/`install_package` with `--ignore-scripts` or prebaked deps/
  native-build/validators) + a runner entrypoint. **No app code, no Prisma URL.**
- Reads the sanitized snapshot from a signed GCS read URL; writes `{ ops, evidence }`
  to a signed GCS write URL; exits (container teardown destroys FS + installs).
- Deploy as Cloud Run Job `studyos-agent-sandbox` under `studyos-sandbox-runner`
  with CPU/mem caps + `--task-timeout`.

## 4. Orchestration, queue, rollout (code, gated by infra)

- `src/lib/ai/sandbox/runner-client.ts` (TBD): mint TASK_ID + short-TTL signed
  GCS URLs, `RunJob` with per-task overrides, poll `executions.get`, cancel via
  `executions.cancel`.
- Intake reuses `parseSandboxResult` → existing `applyAgentOps` →
  `safeParseWorkspace` → `applyAgentWorkspaceChange` (owner + version checked).
- Per-user concurrency + rate limits; enqueue RunJob via **Cloud Tasks** (respect
  RunJob quota / absorb bursts).
- Route only heavy/tool-using/web-reading tasks to the Job behind `AGENT_SANDBOX`;
  keep trivial edits in-process (avoids cold start + proxy cost).
- Security tests (integration): metadata block, RFC1918 block, non-allowlisted
  host block, DOR on another user's workspace, forged/oversized result rejected,
  stale baseVersion rejected, cancelled-task apply refused. Internal dogfood →
  gradual enable.
