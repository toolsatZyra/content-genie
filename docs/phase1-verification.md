# Phase 1 executable verification gates

These commands are destructive to test data. Run them only against the local
Supabase stack or a non-production preview branch/project.

## Disposable database and browser suite

Authenticate the Supabase CLI, select the parent project used to create preview
branches, then run:

```powershell
$env:SUPABASE_PROJECT_REF = "<parent-project-ref>"
pnpm test:live:phase1
```

The command creates a fresh preview branch, resets it to the committed migration
set, runs the three-step forward-rollback drill, runs the live authorization and
browser probes, and deletes the branch in `finally`. Realtime is intentionally
skipped on the new branch because a freshly reset preview branch may not have an
attached replication tenant. The suite records cleanup and forward-rollback
status in `.tmp/artifacts/phase1-live-suite.json`.

The forward-rollback drill applies three distinct forward SQL steps to an
isolated probe table: baseline, candidate change, and compensating change. A
fourth query asserts that the stable contract is restored and that all three
steps remain recorded in order. It does not call `db reset`, `migration down`,
or edit migration history.

The same drill runs in ordinary CI through:

```powershell
pnpm db:test:harness
```

On GitHub's Docker runner this uses the isolated local Supabase stack. When
Docker is unavailable, the harness requires `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_PROJECT_REF`, creates a disposable branch, and deletes it in `finally`.

## Persistent-preview Realtime reconciliation

Use a long-lived **non-production preview project** whose Realtime replication
tenant is attached. Supply its three test credentials and ensure the skip flag
is absent:

```powershell
$env:GENIE_LIVE_SUPABASE_URL = "https://<preview-ref>.supabase.co"
$env:GENIE_LIVE_SUPABASE_ANON_KEY = "<preview-anon-key>"
$env:GENIE_LIVE_SUPABASE_SERVICE_ROLE_KEY = "<preview-service-role-key>"
Remove-Item Env:GENIE_LIVE_SKIP_REALTIME -ErrorAction SilentlyContinue
pnpm test:live:phase1:realtime
```

This gate creates isolated users/workspaces, proves owner delivery and outsider
silence on the published `domain_events` stream, disconnects both clients,
mutates while disconnected, refetches the authoritative Series projection,
reconnects, mutates again, and verifies that the reconciled state did not
resurrect the stale pre-disconnect projection. The harness leaves its uniquely
named test records in the preview project for audit; never point it at production.
