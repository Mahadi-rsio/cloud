# Principal Database Engineer — Revised Resolution Register (Risks 01–41)

> **Reference Audit:** [issue.md](file:///workspaces/cloud/experimental-db/issue.md)  
> **Target System Design:** [plan.md](file:///workspaces/cloud/experimental-db/plan.md)  
> **Governing Engineering Rule:** *Never introduce a custom optimization into the durability path until the standard PostgreSQL implementation works, survives failure testing, and can be independently restored.*

---

## Core Architectural Corrections Summary

1. **RISK-01 (`initdb` Pool Transactional Claims):** Two-phase pool staging (`/vol/pool/staging/{uuid}` -> `pg_controldata` verification -> `fsync` -> `/vol/pool/ready/{uuid}`), Control Plane `UNIQUE (system_identifier)` DB constraint prior to directory claim, and startup orphan purge.
2. **RISK-02 (PG17 Native Incremental Workflow):** Empirical Stage 0 validation of `summarize_wal = on`, unpacked/tar staging, `pg_verifybackup` SHA-256 verification on every full/incremental backup, fallback to full backup if summary continuity breaks, and `pg_combinebackup` + `pg_verifybackup` on restore.
3. **RISK-03/04 (PG-Native Physical Standby First):** Replace the custom Go WAL Sink in Stages 0–2 with a **real PostgreSQL 17 Physical Standby** (`synchronous_standby_names`, `IDENTIFY_SYSTEM`, replication slots, timeline `.history`, `write_lsn`/`flush_lsn`/`apply_lsn`) + `pg_receivewal`. Scoped `RPO=0` applies strictly to single primary failure while synchronous standby is in `sync` state.
4. **RISK-05 (Defense-in-Depth OS Isolation):** Pair `cgroups v2` with Linux namespaces (`CLONE_NEWNS`, `CLONE_NEWPID`, `CLONE_NEWIPC`, loopback-only `CLONE_NEWNET`), `nosuid,nodev,noexec` mounts, `CapBnd=0` + `no_new_privs=1`, and `seccomp-bpf`.
5. **RISK-07 (Gateway-Controlled Drain Protocol):** Remove `pg_listening_channels()` fallacy; drain is driven by the Gateway admission lock, pinned-session tracking, `pg_prepared_xacts` & worker verification, `pg_ctl stop -m smart`, and `pg_controldata` `"shut down"` check.
6. **RISK-10 (Strict Extension Allowlist):** Explicit version-locked extension allowlist, `noexec` on data volumes, no custom `.so` `LOAD`, no untrusted languages, and `supautils` strictly as defense-in-depth.
7. **RISK-11/12 (Session Pooling / PgBouncer First):** Stage 1–2 uses session pooling or proven **PgBouncer (1.21+)**; custom Go transaction pooling & prepared statement virtualization moves to Stage 3 after full Benchmark Group E compatibility proof.
8. **RISK-13 (Stage 0 Fly Volume Verification):** Empirically test Fly `ext4` mount options, `fsync`, IOPS, snapshots, and workload-driven volume sizing before setting production defaults.
9. **RISK-15/16 (R2 Backup Chain Validation):** Verify complete backup-chain dependencies, WAL continuity, timeline `.history`, `pg_verifybackup`, DEK recovery, multipart cleanup, and clean-room restore; empirically test R2 conditional headers before relying on them.
10. **RISK-17 (Hard Linux `ext4` Project Quotas):** Enforce `ext4` `PRJQUOTA` (`chattr +P -p` + `quotactl` -> `EDQUOT`) in the kernel write path alongside `max_slot_wal_keep_size`, `temp_file_limit`, `statement_timeout`, and `.cell_ballast`.
11. **RISK-18 (Write-Boundary Primary Fencing):** Pro tier fences the synchronous standby to `Epoch E+1` *before* promotion (blocking commits on old primary); Standard async tier enforces a monotonic watchdog (`CLOCK_MONOTONIC` + `softdog`) killing local `postgres` at `8.0s` while Control Plane waits `12.0s` before promoting `Epoch E+1`.
12. **RISK-25/26/27/28 (4-Way Billing Separation):** Strictly separate Usage Metering, Infrastructure Cost Accounting, Customer Billing (RU heuristic), and Abuse/Resource Enforcement.

---

## P0 — Critical Architectural Risks

### RISK-01: PostgreSQL Template Cloning & Cluster Identity
- **Severity:** P0
- **Technical Explanation:** Cloning an initialized `PGDATA` duplicates `global/pg_control`'s 64-bit `system_identifier`, causing WAL/backup collisions (`WAL file is from different system`). Even when using `initdb` to generate independent clusters in a pre-warmed pool of 20, crashes mid-`initdb`, concurrent claim races, or pool restoration from backup could assign a corrupt, incomplete, or duplicate cluster unless staging, verification, and claim assignment are transactional.
- **Reproduction Scenario:** Two concurrent API requests claim from `/vol/pool/ready/` without atomic directory locking, or `pg-cell-agent` crashes mid-`initdb` and restarts, mistaking a half-initialized directory for a ready cluster.
- **Potential Impact:** Two tenants sharing a `PGDATA` or `system_identifier`, startup crashes, or cross-tenant WAL replay corruption.
- **Probability:** High under concurrent provisioning or agent crash recovery without two-phase staging and Control Plane DB uniqueness constraints.
- **Proposed Solution:**
  1. **Two-Phase Pool Staging:** Background worker (`nice -n 19`) initializes into `/vol/pool/staging/{uuid}`, runs `initdb --auth=scram-sha-256 --encoding=UTF8`, verifies via `pg_controldata` that `Database cluster state: shut down` and parses `Database system identifier`, writes `pool_meta.json` (`uuid`, `system_identifier`, `pg_version`, `created_at`), calls `fsync` on the directory, and atomically `os.Rename()`s into `/vol/pool/ready/{uuid}`.
  2. **Boot Recovery:** On agent boot, `/vol/pool/staging/*` is immediately deleted; `/vol/pool/ready/*` entries missing valid `pool_meta.json` or failing `pg_controldata` verification are purged.
  3. **Transactional Claim:** `pg-cell-agent` pops a ready directory via an atomic in-memory mutex + `os.Rename()` to `/vol/tenants/claiming/{tenant_id}`, inserts `(tenant_id, system_identifier, cell_id)` into the Control Plane DB which enforces `UNIQUE (system_identifier)` and `UNIQUE (tenant_id)`, verifies `pg_controldata` one final time, and renames to `/vol/tenants/{tenant_id}/pgdata`.
- **Alternative Solutions:** On-demand `initdb` per provisioning request (~400–800ms slower, zero pooling complexity; fallback if pool is empty).
- **Required Dependencies:** PostgreSQL 17 `initdb` and `pg_controldata`, Control Plane PostgreSQL `UNIQUE (system_identifier)` constraint.
- **Performance Implications:** Steady-state claim remains `<5ms` (metadata insert + atomic rename); fallback on-demand `initdb` under pool exhaustion adds ~500ms.
- **Security Implications:** Zero shared `PGDATA`, zero shared `system_identifier`, and immediate purge of partially initialized state.
- **Testing Procedure:** Run 1,000 concurrent provisions while injecting `SIGKILL` into `pg-cell-agent` mid-`initdb` and mid-claim; inspect all resulting clusters with `pg_controldata`.
- **Acceptance Criteria:** 100% unique `system_identifier` verified by Control Plane DB constraint + `pg_controldata`; zero half-initialized clusters ever assigned; clean orphan cleanup on restart.

### RISK-02: PG17 Native Physical & Incremental Backup Correctness (Replacing `FIEMAP`)
- **Severity:** P0
- **Technical Explanation:** `FIEMAP`-based delta scraping risks silent corruption due to Linux `delalloc`, torn 8 KB pages, and missing `pg_backup_start()`/`pg_backup_stop()` boundaries. Replacing it with PostgreSQL 17 native `pg_basebackup --incremental` and `pg_combinebackup` is the correct foundation, *but* requires strict validation of WAL summarization (`summarize_wal = on`), backup manifest chaining, and staging directory handling against real PG17 binaries.
- **Reproduction Scenario:** Attempt `pg_basebackup --incremental=prev_manifest` when `summarize_wal` was toggled off or `wal_summary_keep_time` expired the needed WAL summaries, or run `pg_combinebackup` directly on compressed `.tar.zst` files (which it does not accept without extraction).
- **Potential Impact:** Failed incremental backups, broken restore chains, or inability to recover tenant data during outage.
- **Probability:** High if PG17 incremental prerequisites and tar/unpacked mechanics are not explicitly handled.
- **Proposed Solution:**
  1. Enable `summarize_wal = on` and `wal_summary_keep_time = '48h'` in `postgresql.conf`.
  2. Always capture **unpacked** (`--format=plain`) or stream-extracted staging directories locally or stream tars, verifying **every** base and incremental backup immediately with **`pg_verifybackup`** against its `backup_manifest` (SHA-256) before uploading to R2.
  3. Query `pg_available_wal_summaries()` before triggering `--incremental`; if summary continuity from the parent backup's `end_lsn` is broken or missing, automatically fall back to a **full base backup**.
  4. During restore, extract the chain (`base + incr_1 ... incr_N`) into a pre-checked temporary directory (requiring `>= 2.2x` final size free), execute **`pg_combinebackup -o /restore/out <base> <incr1>...`**, and run **`pg_verifybackup /restore/out`** before starting Postgres.
- **Alternative Solutions:** Full `pg_basebackup` only (higher R2 bandwidth/storage, zero chain dependency—used as default in Stage 0–1 until PG17 `--incremental` passes full chaos testing).
- **Required Dependencies:** PostgreSQL 17 binaries (`pg_basebackup`, `pg_combinebackup`, `pg_verifybackup`), `zstd`.
- **Performance Implications:** `pg_verifybackup` adds CPU/disk scan time proportional to DB size; `--incremental` reduces R2 upload size by 80–95% for write-light workloads.
- **Security Implications:** All backup artifacts verified by SHA-256 `backup_manifest` before envelope encryption.
- **Testing Procedure:** Run Stage 0 test harness against PG17 binaries: continuous `pgbench` writes -> full backup -> 3 consecutive incremental backups -> kill primary -> `pg_combinebackup` -> `pg_verifybackup` -> replay tail WAL -> `pg_amcheck`. Also test forced `wal_summary` expiration fallback.
- **Acceptance Criteria:** 100% pass rate across 50 backup-chain crash/restore tests with `pg_verifybackup` + `pg_amcheck` passing zero errors; automatic fallback to full backup when summary continuity breaks.

### RISK-03: WAL Replication, Physical Streaming Protocol & Scoped `RPO=0`
- **Severity:** P0
- **Technical Explanation:** `pglogrepl` supports logical *and* physical replication, but claiming `RPO=0` requires satisfying PostgreSQL's full physical streaming replication semantics (`IDENTIFY_SYSTEM`, replication slots, timeline `.history` negotiation, WAL segment boundaries, `write_lsn`/`flush_lsn`/`apply_lsn` feedback, `synchronous_standby_names`). An asynchronous WAL upload (`pg_receivewal` / `archive_command` to R2) cannot guarantee `RPO=0`.
- **Reproduction Scenario:** Commit a transaction on Standard Async tier; kill the Cell host 100ms later before the 5s WAL upload completes -> acknowledged commit is lost. Or run a custom WAL forwarder that returns `FlushLSN` before durable remote `fsync`, losing commits on primary+cache failure.
- **Potential Impact:** Silent data loss on failover; false `RPO=0` guarantees.
- **Probability:** High under host failure if async or broken sync implementations are used.
- **Proposed Solution:**
  1. **Stages 0–2 Foundation (PostgreSQL-Native Only):**
     - **Standard Tier (Async):** Use `pg_receivewal --synchronous` (or continuous `archive_command` + `pg_receivewal` into local NVMe + periodic R2 sync). Explicitly documented as **`RPO ≤ 5s` (Async)** on total host loss.
     - **Pro Tier (`RPO=0`):** Use a **real PostgreSQL 17 Physical Standby** running on a separate Cell in a distinct failure zone (`--volume-requires-unique-zone`), connected via a durable physical replication slot and `synchronous_standby_names = 'FIRST 1 (pg_standby_zone2)'` with `synchronous_commit = on` (or `remote_apply`).
  2. **Explicit `RPO=0` Failure Model Scope:** `RPO=0` applies **strictly** to single primary Cell/host failure while the synchronous standby is in `sync` state in `pg_stat_replication` and has confirmed `flush_lsn`. Explicitly excluded: simultaneous primary + standby destruction, regional disaster destroying all zones, or operator-forced failover under standby disconnection (`synchronous_commit` degraded).
  3. Defer any custom Go multi-tenant WAL Sink to post-Stage-3 R&D, gated behind passing 100% protocol equivalence and crash-recovery parity against the PostgreSQL-native physical standby reference.
- **Alternative Solutions:** 2-standby quorum (`ANY 1 (sb1, sb2)`) on 3 separate zones for higher availability during single-standby maintenance without stalling commits.
- **Required Dependencies:** Separate Fly Machine/zone placement (`--volume-requires-unique-zone`) for Pro Tier standby; physical replication slots (`max_slot_wal_keep_size` bounded).
- **Performance Implications:** Sync physical standby adds 1 intra-region `6PN` RTT + standby `fsync` (~1–3ms) per commit on Pro Tier; 0ms overhead on Standard Tier.
- **Security Implications:** Standby replication traffic encrypted over Fly `6PN` + TLS/mTLS client cert auth (`pg_hba.conf` `hostssl replication`).
- **Testing Procedure:** Run external transaction-ledger writer against Pro Tier primary; execute `kill -9` on primary VM immediately after client receives `COMMIT` ack; promote standby and assert 100% of ACKed transactions exist. Separately test standby partition (verify primary blocks commits rather than silently degrading to async unless explicitly configured).
- **Acceptance Criteria:** Zero lost ACKed commits across 50 abrupt primary `kill -9` tests within the defined failure model; full `IDENTIFY_SYSTEM` + timeline switch recovery verified.

### RISK-04: Custom WAL Sink / Queue Durability Pitfalls
- **Severity:** P0
- **Technical Explanation:** A message queue (NATS JetStream) or naive Go WAL Sink is not a drop-in PostgreSQL synchronous standby. A custom WAL durability engine must handle WAL segment boundaries, partial segments, duplicate/out-of-order frames, durable slot state across restarts, timeline switches, quorum membership changes, and fencing when a committed primary is isolated.
- **Reproduction Scenario:** Primary sends WAL frame `LSN 100..200`, WAL Sink crashes before persisting slot metadata or applies frame `200..300` out of order -> recovery replays corrupt WAL or hits segment gap.
- **Potential Impact:** Unrecoverable WAL stream, timeline divergence, or lost committed transactions.
- **Probability:** Very High if custom WAL Sink is deployed before full protocol verification.
- **Proposed Solution:** **Do not use NATS JetStream or a custom Go WAL Sink in Stages 0–3.** Use PostgreSQL 17's native Physical Standby + `pg_receivewal` (RISK-03) for all production durability. Any future Go WAL Sink must implement the complete PostgreSQL physical replication protocol (`IDENTIFY_SYSTEM`, `TIMELINE_HISTORY`, `START_REPLICATION`, `StandbyStatusUpdate` write/flush/apply LSNs), Raft/Paxos durable log persistence, segment-boundary alignment, and strict epoch fencing, and prove parity against native Postgres standby chaos tests before production use.
- **Alternative Solutions:** Use 2-node/3-node PostgreSQL physical standby quorum (`ANY 1 (sb1, sb2)`) managed by Control Plane orchestration.
- **Required Dependencies:** PostgreSQL 17 native `walsender`/`walreceiver` and `pg_receivewal`.
- **Performance Implications:** Higher standby memory overhead per Pro-Tier tenant (~40–50MB standby RSS), factored explicitly into Pro-Tier pricing.
- **Security Implications:** Eliminates custom replication parser vulnerabilities and protocol state desync bugs.
- **Testing Procedure:** Verify standby crash/restart, timeline promotion (`.history` file generation), and slot retention with `pg_receivewal` + standby failover.
- **Acceptance Criteria:** Zero custom WAL Sink code in production durability path for Stages 0–2; native PG standby passes all Group D durability tests.

### RISK-05: Shared Compute Cell Failure Domain & Defense-in-Depth Isolation
- **Severity:** P0
- **Technical Explanation:** `cgroups v2` controls CPU/RAM/IO limits but does **not** prevent cross-tenant filesystem traversal, network pivoting (SSRF over `6PN`), `/proc` inspection, or kernel syscall exploits. Moreover, host/VM kernel crashes, Fly host failures, or shared NIC/disk saturation affect all tenants on that Cell.
- **Reproduction Scenario:** A compromised extension or SQL vulnerability executes a host lookup over `6PN`, reads `/proc` cmdlines of neighboring Postgres processes, or triggers a kernel panic/host OOM affecting all tenants on the Cell.
- **Potential Impact:** Cross-tenant data breach, SSRF into internal Fly services (`6PN`), or whole-Cell outage.
- **Probability:** Medium–High on multi-tenant shared infrastructure without OS-level defense-in-depth.
- **Proposed Solution:**
  1. **OS Containment Per Tenant Process (Inside Firecracker Guest):**
     - **Namespaces:** Spawn each `postgres` process inside isolated `CLONE_NEWPID` (cannot see other PIDs), `CLONE_NEWIPC` (isolated SysV/POSIX shm), `CLONE_NEWNS` + `pivot_root` (with `nosuid,nodev,noexec` on `PGDATA`, `0700` owned by tenant UID `10000+slot`, and a **private per-tenant `tmpfs` `/dev/shm`** `size=64m`), and **`CLONE_NEWNET` (loopback-only)** so tenant Postgres processes have **zero outbound network/6PN access** (communicating solely via bind-mounted Unix socket `/run/pg/{id}/.s.PGSQL.5432`).
     - **Capabilities & Syscalls:** Drop all Linux capabilities (`CapBnd = 0`, `PR_SET_NO_NEW_PRIVS = 1`) and attach a strict **`seccomp-bpf`** allowlist blocking `ptrace`, `bpf`, `kexec_load`, `mount`, `unshare`, and raw sockets.
     - **`cgroups v2` + Zero-Module Fallbacks (`envprobe`):** Enforce `memory.max`, `memory.oom.group = 1`, `pids.max = 64`, `cpu.max`, `io.max`, and reserve 20% RAM (`memory.low`) for `pg-cell-agent` + kernel. Because Fly's stock guest kernel (`fly-kernel`) may omit certain delegated controllers, `pg-cell-agent` runs `envprobe` at startup and always enforces module-free fallbacks: `oom_score_adj = -900` on `pg-cell-agent`, `oom_score_adj = +500` on tenant `postgres` processes, `RLIMIT_NPROC`/`RLIMIT_NOFILE` via `SysProcAttr`, and a 1-second `/proc/<pid>/statm` + `/proc/<pid>/io` watcher.
  2. **Blast Radius Scope:** Clearly document that a single Cell VM is one failure domain (max 80–100 active tenants per 8 GB Cell); host-level kernel/VM failure recovers via Cross-Cell failover (RISK-19), while Pro-Tier tenants get Dedicated Cells/Standbys.
- **Alternative Solutions:** Firecracker VM-per-tenant (stronger hypervisor isolation, available as Dedicated Tier for enterprise/high-security workloads).
- **Required Dependencies:** Linux guest kernel inside Fly Firecracker VM (`cgroups v2`, namespaces, `seccomp`), verified in Stage 0.
- **Performance Implications:** Loopback `CLONE_NEWNET` + Unix socket adds 0ns overhead over standard local IPC; `seccomp-bpf` overhead is `<1%`.
- **Security Implications:** Blocks outbound SSRF from Postgres (`dblink`, `postgres_fdw`, C extensions), cross-tenant `/proc` snooping, and binary execution on `PGDATA`.
- **Testing Procedure:** Inside a tenant session/test harness: attempt outbound TCP connection to `fdaa::3` / `169.254.169.254`, attempt reading sibling `PGDATA` or `/proc` PIDs, attempt executing a binary written to `/tmp`, and inject a cgroup OOM bomb while Tenant B runs `pgbench`.
- **Acceptance Criteria:** 100% failure of network exfiltration, sibling traversal, and binary exec tests; Tenant A OOM kills only Tenant A; separate host-kill chaos test validates cross-Cell recovery.

---

## P1 — PostgreSQL Engineering Risks

### RISK-06: Process-Per-Tenant Lifecycle Management
- **Severity:** P1
- **Technical Explanation:** Unclean crashes, agent restarts, stale `postmaster.pid`, orphaned Unix sockets, concurrent wake/stop requests, and startup timeouts (e.g., crash recovery WAL replay on boot) can deadlock provisioning or launch two primaries against the same `PGDATA`.
- **Reproduction Scenario:** `pg-cell-agent` crashes while 20 tenants are running, restarts, and attempts to boot a second `postgres` over an already-running `PGDATA`, or fails to start because a dead PID left `postmaster.pid` behind.
- **Potential Impact:** `PGDATA` corruption from dual primaries or permanent tenant unavailability (`57P03`).
- **Probability:** High without kernel advisory file locks and PID re-adoption.
- **Proposed Solution:**
  - **Fly `/init` Runtime Compatibility (`PR_SET_CHILD_SUBREAPER` & `SIGTERM 300s`):** Fly injects its own `/init` as PID 1 inside every Firecracker Machine, and defaults to `kill_signal = "SIGINT"` with a **5s `kill_timeout`**. `pg-cell-agent` runs beneath `/init`, **calls `unix.Prctl(unix.PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0)` on boot** so reparented `postgres` backends/helpers reparent to `pg-cell-agent` (preventing `ECHILD` races on `wait4()`), and uses `kill_signal = "SIGTERM"` + `kill_timeout = "300s"` in `fly.cell.toml` with a 16-goroutine parallel drain pool on shutdown so all active clusters checkpoint cleanly in `<15s`.
  - **Advisory Lock (`flock`):** Acquire exclusive non-blocking `unix.Flock(LOCK_EX | LOCK_NB)` on `PGDATA/agent.lock` held by a lightweight shim/descriptor per managed process so two primaries can never open the same `PGDATA`.
  - **Agent Restart Re-Adoption:** On boot, `pg-cell-agent` scans `/proc/*/comm` + `/vol/tenants/*/pgdata/postmaster.pid` and re-attaches supervision to live `postgres` processes without interrupting queries; stale `postmaster.pid` / `.s.PGSQL.5432` are removed only if `flock` succeeds and `/proc/<pid>` is dead.
  - **Startup Timeout & Crash Loop Guard:** Measure startup time across catalog sizes/extensions and after unclean termination; allow configurable crash-recovery startup timeout (e.g., 30s) with exponential backoff and health reporting on repeated crashes.
- **Alternative Solutions:** Run each tenant via `systemd` transient units inside the Cell VM (heavier footprint; Go supervisor + `pidfd` is leaner and deterministic).
- **Required Dependencies:** Linux `flock`, `pidfd_open`/`wait4` reaper (PID 1 zombie reaping).
- **Performance Implications:** Negligible overhead; zombie reaping prevents PID table exhaustion.
- **Security Implications:** Lock files stored `0600` owned by root/agent outside tenant namespace access.
- **Testing Procedure:** `kill -9` `pg-cell-agent` under load and verify zero dropped queries on restart; `kill -9` `postgres`, inject 500 concurrent wake calls, and verify clean crash recovery + single-instance start.
- **Acceptance Criteria:** Zero dual-primary launches; 100% process re-adoption across agent restarts; zero zombie processes left after 1,000 start/stop cycles.

### RISK-07: Scale-to-Zero & Cooperative Drain
- **Severity:** P1
- **Technical Explanation:** Checking a single SQL query (or `pg_listening_channels()`, which only inspects the *calling* backend's channels!) cannot prove a database is safe to shut down. Idle sessions can hold session-level GUCs, temp tables, advisory locks, prepared transactions (`2PC`), background workers, or `LISTEN` registrations, and new connections can arrive between the last check and `pg_ctl stop`.
- **Reproduction Scenario:** Client executes `LISTEN events;` and goes idle; agent inspects `pg_listening_channels()` (returns empty for the agent's connection), stops Postgres, and drops notifications—or a new client connects 5ms after the idle check right as Postgres exits.
- **Potential Impact:** Lost `LISTEN` state, lost temp tables/locks, `ECONNRESET` errors, or stuck `2PC` transactions.
- **Probability:** High under real ORM/async application traffic.
- **Proposed Solution (Gateway-Controlled Drain Protocol):**
  1. Gateway tracks **all** active transactions, pinned sessions (`LISTEN`, `TEMP TABLE`, session `SET`, advisory locks), and open sockets per tenant.
  2. When idle exceeds threshold (and no pinned sessions exist), `pg-cell-agent` requests drain -> Gateway marks tenant `DRAINING` and **stops admitting new transactions** (queuing any new arrivals in memory).
  3. Gateway waits for all in-flight transactions to reach `ReadyForQuery` (`'Z'`), closes pooled backend sockets, and confirms `0 active / 0 pinned` to `pg-cell-agent`.
  4. `pg-cell-agent` verifies `pg_prepared_xacts == 0`, no active replication/background/COPY workers in `pg_stat_activity`, flushes WAL, and runs `pg_ctl stop -m smart` (escalating to `-m fast` only on deadline expiry; never `SIGKILL` unless hung past emergency timeout).
  5. `pg-cell-agent` verifies `pg_controldata` reports `Database cluster state: shut down` and final WAL is archived before notifying Gateway `STOPPED`. If Gateway accumulated held requests during steps 3–4, it immediately triggers wake-up.
- **Alternative Solutions:** Disable scale-to-zero completely for tenants holding active pinned sessions or `2PC` transactions until client disconnects.
- **Required Dependencies:** Gateway-side session/transaction state tracking; `pg_controldata`.
- **Performance Implications:** Adds one short RPC round-trip (~1ms over `6PN`) before shutdown.
- **Security Implications:** Eliminates ungraceful termination and ensures clean credential/socket teardown.
- **Testing Procedure:** Run randomized chaos tests: 1,000 cycles mixing active transactions, `LISTEN/NOTIFY`, advisory locks, `PREPARE TRANSACTION`, `COPY`, and millisecond-late connection arrivals during drain.
- **Acceptance Criteria:** Zero `ECONNRESET` errors; zero shutdowns while `LISTEN`, pinned sessions, advisory locks, or `2PC` transactions are active; `pg_controldata` always confirms `"shut down"` on clean stop.

### RISK-08: Autovacuum & Transaction ID Wraparound
- **Severity:** P1
- **Technical Explanation:** Pre-sleep `VACUUM` fails if a DB runs long-lived queries without sleeping, wakes too briefly for `autovacuum_naptime`, or stays frozen in R2 for months with high `datfrozenxid` or multixact age.
- **Reproduction Scenario:** Workload performs millions of short updates/deletes in 20s bursts, sleeps before `autovacuum` wakes, or holds an open cursor preventing freeze -> XID age climbs until Postgres enters wraparound refusal (`database is not accepting commands`).
- **Potential Impact:** Write outage requiring emergency single-user vacuum.
- **Probability:** Medium–High for write-heavy serverless workloads.
- **Proposed Solution:** Build a **Dedicated Maintenance Scheduler**:
  - Poll `age(datfrozenxid)`, `mxid_age(datminmxid)`, `pg_stat_user_tables` dead tuples, replication slot lag, and `pg_prepared_xacts` age every 5 minutes on active DBs and immediately upon every wake-up.
  - Set `autovacuum_naptime = '15s'`, `autovacuum_vacuum_cost_limit = 400`.
  - **Hard Maintenance Windows:** If `age(datfrozenxid) > 100_000_000` (or `mxid_age > 100_000_000` or dead tuples > 25%), set `maintenance_lock = true` (blocking scale-to-zero), run `VACUUM (FREEZE, INDEX_CLEANUP AUTO)`, and clear lock only upon completion.
  - Before `Deep Freeze` R2 eviction, run `VACUUM (FREEZE)` so archived DBs start with minimal XID age.
- **Alternative Solutions:** Aggressive `vacuum_freeze_min_age = 10000` globally (causes heavy write amplification on normal OLTP—better kept moderate and supplemented by the scheduler).
- **Required Dependencies:** Maintenance goroutine inside `pg-cell-agent` + metrics exporter.
- **Performance Implications:** Controlled `vacuum_cost_delay` avoids I/O starvation for foreground queries during maintenance windows.
- **Security Implications:** Maintenance runs under internal agent role, isolated from tenant permissions.
- **Testing Procedure:** Run continuous high-churn `UPDATE`/`DELETE` workload with forced 25s wake/sleep cycling and verify `age(datfrozenxid)` and table bloat bounds over 10M transactions.
- **Acceptance Criteria:** `age(datfrozenxid)` never exceeds 150M; maintenance windows are never permanently postponed by scale-to-zero.

### RISK-09: PostgreSQL Memory Configuration
- **Severity:** P1
- **Technical Explanation:** `shared_buffers = 16MB` limits shared cache hit ratios for larger working sets, while `work_mem` allocates *per sort/hash node* per query, and parallel workers, `maintenance_work_mem`, extensions, and mmap files can push RSS far past 50MB and cause Cell OOMs.
- **Reproduction Scenario:** A single query with 5 hash joins + 2 parallel workers allocates `5 × 3 × work_mem`, exhausting tenant `memory.max` or Cell memory if over-admitted.
- **Potential Impact:** Tenant OOM kill or Cell-wide memory pressure/thrashing.
- **Probability:** High under analytical/complex SQL queries.
- **Proposed Solution:** Benchmark `shared_buffers` sizes (16MB vs 32MB vs 64MB) per tier in Stage 0; enforce `max_connections = 15`, `work_mem = 4MB`, `maintenance_work_mem = 32MB`, `max_parallel_workers_per_gather = 0` (on shared Cells to stop POSIX `/dev/shm` parallel-worker spikes), disable `huge_pages`, enable `swap_size_mb = 2048` in `fly.cell.toml` as an emergency shock absorber, mount a **private per-tenant `tmpfs` `/dev/shm` (`size=64m`)** inside each tenant's `CLONE_NEWNS` namespace so OOM-killed clusters never leak POSIX DSM segments, and enforce strict **Cell Memory Admission Control** summing `worst_case_rss` + OS/page-cache reservation (25% RAM) before admitting active processes.
- **Alternative Solutions:** Larger tiered `shared_buffers` (64MB–256MB) on Paid/Dedicated Cells where fewer tenants share RAM.
- **Required Dependencies:** `cgroups v2` `memory.max` + `memory.high` + `pg-cell-agent` admission controller.
- **Performance Implications:** Smaller `shared_buffers` relies on Linux Page Cache (double-buffering avoided), trading minor syscall/memcpy overhead for high tenant density.
- **Security Implications:** `cgroups v2` `oom.group = 1` ensures memory overruns kill only the offending tenant.
- **Testing Procedure:** Run multi-join `work_mem` stress queries across 50 concurrent tenants on an 8 GB Cell and monitor `memory.current`, `pg_buffercache`, and p99 latency.
- **Acceptance Criteria:** Zero host/agent OOMs under max admitted concurrency; documented RSS benchmarks across 16MB/32MB/64MB `shared_buffers`.

### RISK-10: PostgreSQL Configuration Isolation
- **Severity:** P1
- **Technical Explanation:** `supautils` alone does not make arbitrary extensions or untrusted code safe. Extensions with C hooks or host-access functions can compromise the shared VM if any arbitrary `.so` is permitted.
- **Reproduction Scenario:** Tenant attempts `CREATE EXTENSION plpython3u;`, `LOAD '/tmp/evil.so';`, `COPY t FROM PROGRAM 'cat /vol/tenants/other/pgdata/...'`, or `ALTER SYSTEM SET archive_command = '...'`.
- **Potential Impact:** Privilege escalation to host OS user and cross-tenant data theft.
- **Probability:** Medium–High on multi-tenant SQL platforms if untrusted extensions or `SUPERUSER` exist.
- **Proposed Solution:**
  1. Never grant `SUPERUSER`; tenant receives restricted `app_owner`.
  2. Enforce a **strict, version-locked Extension Allowlist** (`uuid-ossp`, `pgcrypto`, `pg_trgm`, `citext`, `btree_gin`, `btree_gist`, `hstore`, `vector`, `pg_stat_statements`)—do **not** advertise arbitrary extension support on shared Cells.
  3. Mount tenant directories `noexec,nosuid,nodev`; strip `LOAD` access; block untrusted procedural languages; protect `postgresql.conf`/`pg_hba.conf` (`0600` owned by root, inaccessible to tenant UID).
  4. Use `supautils` strictly as one defense-in-depth layer alongside OS namespaces (RISK-05) to delegate safe creation of allowlisted extensions and lock down reserved roles/GUCs.
- **Alternative Solutions:** Dedicated Firecracker VM Cells for enterprise users requiring custom extensions or `PostGIS`/`PL/Python`.
- **Required Dependencies:** `supautils` compiled for PG17, strict allowlist configuration, OS UID/namespace isolation.
- **Performance Implications:** Zero runtime query overhead.
- **Security Implications:** Eliminates known PostgreSQL superuser escape paths (`COPY PROGRAM`, `LOAD`, `pg_read_server_files`).
- **Testing Procedure:** Automated privilege-escalation threat suite executing `COPY PROGRAM`, `LOAD`, `CREATE LANGUAGE`, `pg_read_file`, `pg_ls_dir`, and `ALTER SYSTEM`.
- **Acceptance Criteria:** 100% of escalation vectors rejected by PostgreSQL and blocked at OS/namespace layer if bypassed.

### RISK-11: Prepared Statement Virtualization & Protocol Compatibility
- **Severity:** P1
- **Technical Explanation:** Transaction pooling requires full Extended Query state machine fidelity (`Parse`, `Bind`, `Describe`, `Execute`, `Close`, `Sync`, `Flush`, unnamed `""` statements/portals, pipeline mode, error recovery skipping until `Sync`, DDL invalidation, `DEALLOCATE ALL`, `DISCARD ALL`, `CancelRequest`), plus handling session-bound features (`TEMP TABLE`, `SET`, advisory locks, `2PC`). Building a custom wire-protocol virtualizer before proving core stability creates huge schedule and correctness risk.
- **Reproduction Scenario:** Prisma or JDBC sends `Parse("")` + `Bind` + `Execute` in pipeline mode, or runs `ALTER TABLE` invalidating a cached plan, or creates a `TEMP TABLE` across two pooled transactions routed to different backends.
- **Potential Impact:** Silent wrong query results, `prepared statement does not exist` crashes, and broken migrations.
- **Probability:** **100%** with naive `Parse`-map transaction pooling.
- **Proposed Solution:**
  - **Stages 1–2 (Production Foundation):** Deploy **Session Pooling** or battle-tested **PgBouncer (1.21+)** (which natively supports protocol-level prepared statement tracking in transaction mode and clean session pooling) so a custom wire virtualizer does **not** block initial production release.
  - **Stage 3 (Custom Go Pooler):** Implement full `pgproto3` Extended Query state machine + `Sync` error-drain + DDL invalidation + automatic Session Pinning (`TEMP TABLE`, `SET`, `pg_advisory_lock`, `LISTEN`, `2PC`) only after passing **100% of Benchmark Group E** across Prisma, Drizzle, `pgx`, `sqlx`, JDBC, `node-postgres`, and `psql`.
- **Alternative Solutions:** Keep PgBouncer per-Cell permanently as the backend pooler behind `pg-gateway` (eliminates writing a custom transaction pooler completely while Go Gateway handles SNI, routing, wake-up, and metering).
- **Required Dependencies:** PgBouncer 1.21+ (Stages 1–2) or `pgproto3` state machine (Stage 3).
- **Performance Implications:** Session pooling caps backend concurrency at `max_connections` per tenant; PgBouncer/Stage-3 transaction pooling multiplexes thousands of idle clients.
- **Security Implications:** Per-tenant isolated pool contexts; `DISCARD ALL` verified between unpinned backend handoffs.
- **Testing Procedure:** Execute Benchmark Group E test apps (Prisma migrate/CRUD, Drizzle, `pgx` pipeline mode, `sqlx` prepared cache, JDBC `useServerPrepStmts`, `COPY`, `CancelRequest`, `LISTEN/NOTIFY`).
- **Acceptance Criteria:** 100% pass rate across all 7 real ORM/driver test suites before enabling transaction pooling in production.

### RISK-12: PostgreSQL Connection Pooling
- **Severity:** P1
- **Technical Explanation:** Serverless workloads open thousands of short-lived connections concurrently, exhausting `max_connections = 15` per tenant or global Cell FD/memory limits, or leaking idle pinned sessions.
- **Reproduction Scenario:** 500 serverless lambda workers connect simultaneously to a single tenant holding 50ms transactions -> without bounded queues and pool timeouts, Postgres hits `FATAL: sorry, too many clients already`.
- **Potential Impact:** Connection storms causing cascading timeouts and Cell memory exhaustion.
- **Probability:** High in serverless environments.
- **Proposed Solution:** Enforce explicit two-level limits: (1) Per-tenant client connection cap at Gateway (e.g., 200 concurrent clients) + max backend pool size (10–15) + 5s pool wait timeout returning structured `53300` pool-exhaustion error; (2) Global Cell backend cap (max 1,200 total Postgres backends per 8 GB Cell); (3) Automatic Session Pinning timeout (idle pinned session reclaimed or rejected past limit) and transaction `CancelRequest` forwarding.
- **Alternative Solutions:** Dedicated PgBouncer instance per active Cell managed by `pg-cell-agent`.
- **Required Dependencies:** `pg-gateway` / PgBouncer pool manager.
- **Performance Implications:** Keeps Postgres backend process count bounded while supporting high client fan-in.
- **Security Implications:** Per-tenant connection caps prevent one tenant from exhausting global Cell connection limits.
- **Testing Procedure:** Blast 1,000 concurrent connections across 1 tenant and 20 tenants simultaneously; verify clean queuing, bounded backend count, and uninterrupted Tenant B throughput.
- **Acceptance Criteria:** Zero `too many clients` crashes; Tenant A connection flood never starves Tenant B backends.

---

## P1 — Storage & Data Durability Risks

### RISK-13: Fly.io `ext4` Volume Compatibility & Infrastructure Verification
- **Severity:** P1
- **Technical Explanation:** Fly Volumes are `ext4` (not XFS/reflink), tie 1:1 to a single physical host, cannot shrink after extension, and exhibit platform-specific `fsync`/IOPS and machine-replacement behaviors. Assuming a universal 80 GB volume size without workload/cost testing risks wasted spend or capacity exhaustion.
- **Reproduction Scenario:** Assume XFS `FICLONE` exists on Fly (fails `EOPNOTSUPP`), or deploy a single 500 GB volume that sits 90% empty (cannot be shrunk, permanently billed at $0.15/GB).
- **Potential Impact:** Failed deployments, irreversible storage overspend, or unexpected downtime during Fly host maintenance.
- **Probability:** **100%** if unproven filesystem/volume assumptions are deployed.
- **Proposed Solution:** Standardize strictly on Fly **`ext4`** with strict **rootfs `/` vs `/vol` separation** (`TMPDIR=/vol/tmp` globally; all staging, `initdb` pools, `PGDATA`, and `.cell_ballast` on `/vol`, never ephemeral `/` rootfs; sockets on `16m` `tmpfs` `/run/pg`). In **Stage 0**, run `envprobe` on live Fly hardware testing actual `ext4` mount flags (specifically `CONFIG_QUOTA`/`prjquota` and `CONFIG_BLK_DEV_LOOP` `/dev/loop*` availability), `fsync` latency (`pg_test_fsync`), random/seq IOPS (`fio`), machine replacement persistence, `snapshot_retention` restore time, and online `fly volumes extend` behavior. Size Cell volumes dynamically by tier/workload profile (e.g., 20 GB dev Cells, 80–200 GB production Cells) rather than hardcoding one universal size.
- **Alternative Solutions:** Dedicated local ephemeral NVMe scratch for strictly stateless read replicas; multi-volume sharded Cells.
- **Required Dependencies:** Real Fly.io Machines & Volumes in Stage 0 test environment.
- **Performance Implications:** Local NVMe `ext4` delivers low `fsync` latency without network block-store hops.
- **Security Implications:** Volume encrypted at rest by Fly infrastructure + per-tenant OS permissions (`0700`) and envelope-encrypted R2 backups.
- **Testing Procedure:** Execute `pg_test_fsync`, `fio`, `findmnt`, simulated Machine replacement with existing volume ID, and snapshot restore on real Fly hardware.
- **Acceptance Criteria:** Documented empirical Stage 0 benchmark report confirming `ext4` mount options, `fsync` p99, persistence on Machine replace, and snapshot recovery behavior.

### RISK-14: Storage Accounting & CoW/Volume Space Tracking
- **Severity:** P1
- **Technical Explanation:** Even on `ext4` (with reflinks removed from Stages 0–2), unlinked open files (deleted WAL/temp files held by active backends), WAL segment bursts, and `pg_wal/summaries` bloat cause `du` vs `df` discrepancies and disk exhaustion if not accounted accurately. (If reflinks are ever explored in Stage 3+ on custom hosts, CoW extent amplification and shared/unshared block accounting must also be solved.)
- **Reproduction Scenario:** Long-running query holds a deleted 2 GB temporary file open, or interrupted `initdb` leaves orphaned staging directories—causing `df` to hit 100% while per-DB `pg_database_size()` reports small usage.
- **Potential Impact:** Unexpected Cell volume exhaustion or inaccurate tenant storage billing.
- **Probability:** Medium–High under heavy write/temp-file churn.
- **Proposed Solution:** Track **both** logical DB size (`pg_database_size()`) and physical directory/project quota usage (`quotactl` `ext4` project accounting including `pg_wal`, `base/pgsql_tmp`, and backup staging), reconcile `df` vs sum of tenant project allocations every 60s to catch open-unlinked files or orphaned staging dirs, and defer any CoW/reflink accounting strictly to Stage 3+ R&D.
- **Alternative Solutions:** Dedicated loopback image file per tenant on `ext4` (simpler hard cap, higher double-fs overhead).
- **Required Dependencies:** `ext4` `PRJQUOTA` kernel accounting (`quotactl`).
- **Performance Implications:** `quotactl` queries run in microseconds (O(1) kernel metadata read vs slow `filepath.Walk`).
- **Security Implications:** Prevents tenants from hiding disk usage in unlinked files or `pgsql_tmp`.
- **Testing Procedure:** Create large temp tables, abort transactions, delete files while open, and assert `quotactl` + reconciliation matches `df` within `<2%`.
- **Acceptance Criteria:** Real-time O(1) disk accounting per tenant accurate within `<2%` of physical blocks consumed on `ext4`.

### RISK-15: Cloudflare R2 Reliability, Atomicity & Backup Validation
- **Severity:** P1
- **Technical Explanation:** Object upload HTTP `200` does not guarantee a recoverable backup. Interrupted multipart uploads leak storage, concurrent manifest writes can overwrite newer backup chains, encryption keys can be lost, and S3-compatible conditional headers (`If-None-Match`, `If-Match`) can behave subtly differently across multipart vs single-PUT operations.
- **Reproduction Scenario:** Network drops mid-multipart upload leaving orphan parts; two Cells update `manifest.json` simultaneously; or a backup completes upload with a missing WAL dependency segment.
- **Potential Impact:** Unrecoverable backups, silent backup chain gaps, and wasted R2 multipart storage bills.
- **Probability:** Medium–High at scale without lifecycle GC and validation gates.
- **Proposed Solution:**
  1. **Stage 0 R2 Verification:** Empirically test Cloudflare R2 single-PUT and `CompleteMultipartUpload` conditional headers (`If-None-Match: "*"`, `If-Match: "<etag>"`), concurrency races, and latency/throughput from every target Fly region.
  2. **Abort Incomplete Multipart Uploads:** Configure R2 Bucket Lifecycle Rule aborting incomplete multipart uploads after 24 hours.
  3. **Atomic Two-Phase Publish:** Upload backup + `backup_manifest` -> verify `pg_verifybackup` + verify DEK decryption key unwrap -> verify continuous WAL chain from previous backup -> CAS update `manifest.json` via verified `If-Match` (or Control Plane DB lock if conditional op fails).
  4. **Automated Clean-Room Restore Drills:** Weekly Control Plane worker restores random tenant backups into a fresh Cell and runs `pg_amcheck`.
- **Alternative Solutions:** Replicate critical manifests into Control Plane HA Postgres alongside R2 (`manifest.json` acts as mirror).
- **Required Dependencies:** Cloudflare R2 Bucket lifecycle rules, Control Plane KMS/KEK, `pg_verifybackup`.
- **Performance Implications:** Parallel multipart uploads saturate Cell uplink; weekly drills run on dedicated background verification Cells.
- **Security Implications:** Envelope encryption (per-tenant DEK wrapped by KMS KEK); IAM keys scoped per Cell/Control Plane.
- **Testing Procedure:** Inject mid-upload disconnects, concurrent manifest PUT races, corrupted byte flips in R2 objects, and run clean-room restores from scratch (empty Cell, lost local state).
- **Acceptance Criteria:** 100% rejection of corrupted/incomplete chains; zero orphan multipart uploads >24h; verified empirical R2 conditional test log.

### RISK-16: Point-in-Time Recovery (PITR)
- **Severity:** P1
- **Technical Explanation:** PITR fails if `min_required_wal_seg` for a base backup isn't tracked, timeline `.history` files are missing after failover, or WAL archiving lags/gaps occur.
- **Reproduction Scenario:** User requests PITR to `14:05:00 UTC` after a failover switched from Timeline 1 to Timeline 2; restore fails because Timeline `00000002.history` wasn't archived to R2.
- **Potential Impact:** Failed PITR or inability to recover before accidental `DROP TABLE`.
- **Probability:** High after failovers if timeline history files aren't explicitly archived and tested.
- **Proposed Solution:** Archive **all** `.history` files alongside WAL segments; record `(backup_id, timeline_id, start_lsn, end_lsn, start_time, end_time, min_wal_seg, max_wal_seg)` in Control Plane catalog + `manifest.json`; enforce retention GC so a base backup and its WAL segments cannot be deleted while still needed by a newer incremental chain or active PITR window. Restore into an isolated recovery directory/tenant via `pg_combinebackup` + `recovery_target_time`/`recovery_target_lsn` + `recovery_target_action = 'promote'`.
- **Alternative Solutions:** Daily snapshot restore only (no sub-day RPO; unacceptable for PITR).
- **Required Dependencies:** PG17 `pg_combinebackup`, `restore_command` fetching `.wal.zst` + `.history` from R2.
- **Performance Implications:** PITR restore time scales with base backup + incremental chain + WAL replay volume since last checkpoint.
- **Security Implications:** PITR clones preserve original tenant isolation and generate new rotated credentials.
- **Testing Procedure:** Execute `CREATE TABLE`, insert rows, trigger failover (Timeline 1 -> 2), insert more rows, `DROP TABLE`, and run PITR to timestamp before `DROP TABLE` on a clean Cell.
- **Acceptance Criteria:** Exact recovery of pre-`DROP` data across timeline switches; failed recovery leaves zero corrupted production state.

### RISK-17: Storage Quotas & Disk Exhaustion
- **Severity:** P1
- **Technical Explanation:** Polling directory sizes every 30 seconds cannot stop a tenant from writing 50 GB of WAL or `pgsql_tmp` in 10 seconds, filling the shared `ext4` volume and halting every other tenant on the Cell. Setting `default_transaction_read_only = on` is only a soft mitigation (does not block superuser/autovacuum WAL or temp spills before triggers).
- **Reproduction Scenario:** Tenant A runs `INSERT INTO t SELECT md5(random()::text) FROM generate_series(1, 50000000)` filling the 80 GB volume in 15 seconds before the 30s watcher triggers.
- **Potential Impact:** Whole-Cell `ENOSPC` panic affecting all neighboring tenants.
- **Probability:** High without kernel-enforced write boundaries.
- **Proposed Solution (Multi-Layer Hard Enforcement):**
  1. **Kernel Hard Boundary (`ext4 PRJQUOTA`) + Zero-Module Fallback:** If `envprobe` confirms `prjquota` on Fly's `ext4` volume, assign unique `project_id` (`chattr +P -p <proj_id>`) to each `/vol/tenants/{id}` directory and enforce hard block/inode limits via `quotactl` (`EDQUOT`). If Fly's guest kernel omits `CONFIG_QUOTA` and `/dev/loop`, enforce the zero-module fallback: `setrlimit(RLIMIT_FSIZE, 1GB)` + PG bounds + **1-second `/proc/<pid>/io` `write_bytes` poller** flipping offending tenants `default_transaction_read_only = on` and running `pg_terminate_backend()` within 1s (bounding overshoot to `<25 MB`).
  2. **PostgreSQL Guardrails:** Enforce `temp_file_limit = '256MB'`, `max_wal_size = '256MB'`, `wal_keep_size = '64MB'`, `statement_timeout = '10s'`, and `max_slot_wal_keep_size = '256MB'` (prevents orphaned replication slots from filling WAL).
  3. **Cell-Level Reserve & Write Protection:** Pre-allocate 2 GB `/vol/.cell_ballast` reserved emergency space; admission control blocks new tenants at 75% volume usage; at 85% triggers urgent evictions; at 92% flips highest-growth unpinned tenants read-only and frees `.cell_ballast` so `CHECKPOINT`/`DROP` never hit `ENOSPC`.
- **Alternative Solutions:** Dedicated loop device (`truncate` + `mkfs.ext4`) per tenant (hardest boundary, ~5–10% loop I/O overhead—viable fallback if Fly guest `ext4` lacks `prjquota`).
- **Required Dependencies:** `ext4` `prjquota` mount support (or loop-file fallback verified in Stage 0).
- **Performance Implications:** Kernel `prjquota` accounting has virtually zero I/O overhead.
- **Security Implications:** Eliminates noisy-neighbor disk exhaustion DoS.
- **Testing Procedure:** Run infinite bulk `INSERT` + runaway `CREATE INDEX` + replication slot pause in Tenant A while Tenant B executes continuous OLTP writes.
- **Acceptance Criteria:** Tenant A hits `EDQUOT` / `temp_file_limit` cleanly at its exact quota while Tenant B experiences zero `ENOSPC` errors or volume stall.

---

## P1 — High Availability & Distributed System Risks

### RISK-18: Split-Brain & Epoch Fencing
- **Severity:** P1
- **Technical Explanation:** Updating a Gateway routing table or assuming a "10s lease fenced in 500ms" works during network partitions or VM clock/scheduling stalls is unsafe. If an isolated primary keeps accepting commits from cached clients or local connections, dual primaries exist. The old primary **must** be prevented from committing writes at the storage/commit boundary.
- **Reproduction Scenario:** Cell #1 experiences a 15-second GC/host stall or loses network to Control Plane; Control Plane promotes Cell #2 (`Epoch 2`). Cell #1 wakes up and commits an in-flight local transaction before noticing lease expiry.
- **Potential Impact:** Divergent timelines and silent loss of committed transactions.
- **Probability:** Medium–High during asymmetric network partitions.
- **Proposed Solution:**
  1. **Pro Sync Tier (Exact Storage/Commit-Boundary Fencing):** Control Plane atomically advances `epoch` (`Epoch 1 -> Epoch 2`) in the 3-node HA Control DB and updates the **PostgreSQL Synchronous Standby** (`pg_hba` / `primary_conninfo` / standby promotion) **before** promoting `Epoch 2`. Once the standby is promoted (or fenced off `Epoch 1`), the old primary literally **cannot finish any `COMMIT`** because `synchronous_standby_names` never receives a flush ACK!
  2. **Standard Async Tier (Watchdog + Lease Timing Margin):** Because async local writes commit to local NVMe without standby ACK, `pg-cell-agent` runs a strict monotonic timer (`CLOCK_MONOTONIC` + Linux `softdog` kernel watchdog) that executes immediate `SIGKILL` against tenant `postgres` processes at **8.0s** without Control Plane lease renewal, while the Control Plane enforces a mandatory **12.0s safety window** (`8s watchdog + 4s margin`) before promoting `Epoch 2` on another Cell.
  3. **Storage Boundary Fence:** Both R2 (`manifest.json` `If-Match` + `epoch_{n}` prefixes) and standby slots reject writes from any `epoch < current_epoch`.
- **Alternative Solutions:** Shared network quorum block storage (unavailable on Fly local NVMe).
- **Required Dependencies:** 3-node HA Control Plane DB, monotonic clock/Linux `softdog`, synchronous standby promotion ordering.
- **Performance Implications:** Pro Tier blocks writes cleanly during partitions (`RPO=0`); Standard Async Tier incurs 12s worst-case failover pause to prevent split-brain.
- **Security Implications:** Stale nodes are fenced cryptographically (rotated internal certs/credentials on promotion) and at storage boundaries.
- **Testing Procedure:** `iptables` blackhole partition between Cell #1 and Control Plane/Standby while clients continuously send writes; verify commit rejection on Pro Tier and mandatory `SIGKILL` watchdog termination before Cell #2 promotion on Standard Tier.
- **Acceptance Criteria:** Zero intervals where two primaries can commit writes simultaneously across 30 partition chaos tests.

### RISK-19: Cross-Cell Failover
- **Severity:** P1
- **Technical Explanation:** Aggressive health checks trigger false-positive failovers during brief GC pauses or load spikes; simultaneous promotion attempts or missing WAL/R2 availability during failover can corrupt state or fail recovery.
- **Reproduction Scenario:** Cell #1 pauses 600ms during heavy checkpoint; Gateway triggers failover prematurely while Cell #1 is alive, or both Gateway #1 and Gateway #2 try to promote Cell #2 and Cell #3 simultaneously.
- **Potential Impact:** Unnecessary downtime, failover thrashing, or conflicting promotions.
- **Probability:** Medium without hysteresis and distributed promotion locks.
- **Proposed Solution:**
  - **Failover Hysteresis:** Require **3 consecutive probe failures** across 2 independent paths (Gateway + Control Plane health checker over 3 × 1s = 3s) before declaring a Cell dead, distinguishing slow queries (TCP alive, PG responding to health ping) from dead Cells.
  - **Distributed Promotion Lock:** Control Plane acquires an atomic DB transaction lock (`SELECT ... FOR UPDATE` + `epoch` CAS) on `tenant_id` so only one failover coordinator can run promotion.
  - **Degraded Dependency Handling:** If R2 is unavailable during failover, Pro Tier fails over directly to its live physical standby (which already holds all data + WAL); if Standby is unreachable, promote only within explicit policy/alerting (never silently lose data under `RPO=0` policy without operator/tier override).
  - **Realistic RTO/RPO Targets:** Documented empirically only after Stage 2 benchmarks; target Pro Tier failover in a few seconds (standby `pg_promote()`), Standard Tier R2 restore proportional to DB size.
- **Alternative Solutions:** Manual operator failover for Standard Tier when local host failure occurs without live standby.
- **Required Dependencies:** Multi-path health prober, Control Plane transactional lock, PostgreSQL standby (`pg_promote()`).
- **Performance Implications:** Probe overhead <0.1% CPU; 3s hysteresis prevents false failovers.
- **Security Implications:** Old primary rejoining is quarantined (`state = FENCING_OLD_PRIMARY`) and purged rather than re-attaching directly.
- **Testing Procedure:** Inject 800ms latency spikes (must NOT fail over), abrupt host power-off (MUST fail over), concurrent failover triggers, and R2 outage during Pro-Tier standby promotion.
- **Acceptance Criteria:** Zero false failovers under 1s transient stalls; zero duplicate promotions; old primary cleanly quarantined on rejoin.

### RISK-20: Live Migration
- **Severity:** P1
- **Technical Explanation:** Migrating a hot/large tenant between Cells (for load balancing or Dedicated Tier promotion) without downtime must handle continuous WAL catch-up, DDL schema changes, long-running transactions, slot retention, and source/target failure mid-migration.
- **Reproduction Scenario:** Trigger live migration while an `ALTER TABLE` and 10-second transaction execute; source Cell drops or target Cell lags behind `max_slot_wal_keep_size`.
- **Potential Impact:** Migration hang, aborted transactions, or split-brain during cutover.
- **Probability:** Medium under active production migrations.
- **Proposed Solution:** Use **PostgreSQL Physical Streaming Replication** (identical cluster version on target Cell):
  1. Target Cell restores base backup from R2 (or streams `pg_basebackup` from source over `6PN`) and starts as a physical standby using a bounded replication slot (`max_slot_wal_keep_size`).
  2. Physical WAL automatically replicates all DDL, indexes, and sequences without logical-replication DDL gaps.
  3. Wait until `pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) < 64 KB` and no long-running write txn is active -> Gateway enters brief `DRAINING` cutover pause -> verify `replay_lsn == primary_flush_lsn` -> fence source Cell (`epoch++`) -> execute `pg_promote()` on target -> switch Gateway route -> drop slot & decommission source after grace period.
  4. **Abort Safety:** If target fails before cutover, cancel migration and drop slot immediately; if source fails before cutover, abort and fall back to standard failover.
- **Alternative Solutions:** Cold R2 freeze + restore (simpler, causes ~1–10s downtime—acceptable for idle/small tenants, avoided for active migrations).
- **Required Dependencies:** Physical streaming replication over `6PN`, Gateway drain barrier, `pg_promote()`.
- **Performance Implications:** Brief read/write pause (<200ms target) strictly during cutover LSN sync.
- **Security Implications:** Streaming slot uses dedicated encrypted replication role and mTLS over `6PN`.
- **Testing Procedure:** Migrate an active `pgbench` tenant running concurrent DDL (`CREATE INDEX CONCURRENTLY`, `ALTER TABLE`) while injecting target crash mid-sync and source crash pre-cutover.
- **Acceptance Criteria:** Zero lost committed transactions, zero duplicate primaries, and clean rollback on pre-cutover failure.

---

## P1 — Security & Multi-Tenant Isolation

### RISK-21: Process & Operating System Isolation
- **Severity:** P1
- **Technical Explanation:** Shared-kernel processes require strict OS hardening beyond UIDs/cgroups.
- **Reproduction Scenario:** Malicious tenant exploits an extension or local symlink to access `/proc`, host mounts, `/sys/fs/cgroup`, or `pg-cell-agent` sockets.
- **Potential Impact:** Cross-tenant compromise or host takeover inside the Firecracker VM.
- **Probability:** Low–Medium if hardened, High if unhardened.
- **Proposed Solution:** Dedicated non-root UID (`10000+slot`), `0700` dirs, `CLONE_NEWNS` + `pivot_root` chroot into tenant root containing only minimal PG binaries & `PGDATA` (hiding `/sys/fs/cgroup`, `/vol/tenants/other`, host `/etc`), `CLONE_NEWPID` (hides all other `/proc` processes), loopback-only `CLONE_NEWNET`, `CapBnd=0`, `no_new_privs=1`, `seccomp-bpf` filter, and strict input validation in `pg-cell-agent`.
- **Alternative Solutions:** Dedicated Firecracker microVM per tenant (offered as Dedicated Tier).
- **Required Dependencies:** Firecracker guest Linux namespaces, `seccomp-bpf`, `pivot_root`.
- **Performance Implications:** Negligible startup overhead (<3ms for namespace setup).
- **Security Implications:** Prevents process visibility, privilege escalation, and network exfiltration from tenant PG processes.
- **Testing Procedure:** Penetration test inside tenant shell/UDF simulation checking `/proc`, `/sys`, `/vol`, UIDs, capabilities (`CapEff`), and outbound sockets.
- **Acceptance Criteria:** `CapEff == 0`, `/proc` shows only tenant PIDs, `/vol/tenants/*` invisible, outbound TCP fails with `ENETUNREACH`.

### RISK-22: PostgreSQL Security
- **Severity:** P1
- **Technical Explanation:** Superuser privileges, weak auth, plaintext secrets in process arguments/env, and shared role visibility expose tenant data.
- **Reproduction Scenario:** Inspect `/proc/<pid>/environ` or run `COPY ... PROGRAM`, `ALTER ROLE ... SUPERUSER`, or connect to another tenant DB via shared auth.
- **Potential Impact:** Credential leakage or cross-tenant SQL breach.
- **Probability:** Medium without hardened PG role/config policies.
- **Proposed Solution:** Enforce `SCRAM-SHA-256` with per-tenant randomly generated passwords & rotation API; never pass secrets on CLI args or long-lived env vars (use `0600` ephemeral pipe/files inside root namespace); revoke `PUBLIC` schema/connect grants where unsafe; block superuser, `COPY PROGRAM`, `LOAD`, and untrusted languages; bind tenant socket directory exclusively to Gateway/agent bridge; parameterize all management SQL in `pg-cell-agent` (zero string-formatted SQL).
- **Alternative Solutions:** Client mTLS certificate auth for internal control queries.
- **Required Dependencies:** PostgreSQL `SCRAM-SHA-256`, `supautils`, parameterized `pgx` queries in agent.
- **Performance Implications:** `SCRAM-SHA-256` verification cached cleanly at Gateway/pooler.
- **Security Implications:** Zero superuser escalation paths; zero SQL injection in management layer.
- **Testing Procedure:** Run SQL injection fuzzing on management API, verify `/proc/<pid>/cmdline` and `environ` contain no secrets, and test cross-tenant role/DB connection attempts.
- **Acceptance Criteria:** 100% rejection of privilege/cross-DB attempts; zero secrets visible in `/proc`.

### RISK-23: Gateway Security
- **Severity:** P1
- **Technical Explanation:** Public Port `5432` Gateway faces TLS downgrades, malformed `pgproto3` frames, memory-exhaustion packets (`StartupMessage` claiming 1 GB length), Slowloris connections, SNI spoofing, and auth brute-force.
- **Reproduction Scenario:** Attacker sends `StartupMessage` with `length = 0x7FFFFFFF`, opens 10,000 half-open TLS sockets, or sends SNI `tenant_a` while authenticating with `tenant_b`'s username.
- **Potential Impact:** Gateway OOM crash, connection starvation, or cross-tenant routing confusion.
- **Probability:** **High** on any public internet endpoint.
- **Proposed Solution:** Wildcard TLS 1.2/1.3 via DNS-01 ACME (`crypto/tls`); strict pre-auth deadlines (5s `SSLRequest`/TLS/Startup timeout); hard packet size caps (8 KB `StartupMessage`, 64 MB wire packet); per-IP token-bucket connection rate limit + exponential backoff on SCRAM failures; strict **cryptographic binding** requiring authenticated `username`/`tenant_id` to match TLS SNI (reject mismatch immediately); redacting structured logger scrubbing all SQL literals and auth tokens; clean `CancelRequest` validation using cryptographically random 32-bit backend secret keys.
- **Alternative Solutions:** Put Cloudflare Spectrum / AWS NLB in front (costly per-GB for Postgres TCP; Fly Dedicated IPv4 + `handlers = []` + hardened Go Gateway is cleaner and cheaper).
- **Required Dependencies:** `crypto/tls`, `golang.org/x/time/rate`, bounded `io.LimitReader` in `internal/wire`.
- **Performance Implications:** Bounded buffers cap per-connection memory (<16 KB idle).
- **Security Implications:** Neutralizes Slowloris, OOM framing attacks, SNI spoofing, and brute-force storms.
- **Testing Procedure:** Fuzz Gateway port `5432` with malformed lengths, 5,000 Slowloris sockets, SNI/user mismatches, and SCRAM brute force.
- **Acceptance Criteria:** Gateway memory stays bounded; malformed packets dropped in `<1ms` without panic; 100% SNI mismatch rejection.

### RISK-24: Tenant Data Security
- **Severity:** P1
- **Technical Explanation:** Backups in R2, orphaned snapshots, logs, and soft-deleted tenants risk data exposure or compliance violations (GDPR/SOC2) if encryption keys aren't tenant-isolated or deleted backups linger.
- **Reproduction Scenario:** Tenant deletes database, but old WAL segments or base backups remain readable in R2 for months or logs dump user query values.
- **Potential Impact:** Regulatory non-compliance and unauthorized data retention/exposure.
- **Probability:** Medium without automated retention & crypto-shredding.
- **Proposed Solution:** Envelope encryption using per-tenant Data Encryption Keys (DEKs) wrapped by Control Plane KEK with periodic key rotation; R2 object lifecycle/GC worker tied to tenant deletion (`soft-delete` 7-day grace -> hard delete all R2 prefix objects + **crypto-shred** DEK immediately); explicit regional Cell/R2 pinning for data residency; immutable audit log for all admin/restore/delete operations; zero SQL payload logging at Gateway/Agent.
- **Alternative Solutions:** R2 SSE-S3 only (lacks per-tenant cryptographic isolation/crypto-shredding).
- **Required Dependencies:** KMS/KEK key management, R2 GC worker, audit table.
- **Performance Implications:** AES-GCM / ChaCha20-Poly1305 streaming encryption runs at >2 GB/s in Go hardware AES-NI.
- **Security Implications:** Deleted tenant data becomes mathematically unrecoverable immediately upon DEK destruction even before async R2 sweep finishes.
- **Testing Procedure:** Delete tenant, verify async R2 GC deletes objects, and verify historical backup chunks cannot decrypt after DEK revocation.
- **Acceptance Criteria:** 100% cryptographic erasure on hard delete; zero PII/SQL literals in system logs.

---

## P1 — Billing & Request Metering Risks

### RISK-25: Request Unit (RU) Accuracy & Wire Semantics
- **Severity:** P1
- **Technical Explanation:** A simple wire counter (`CommandComplete` + `ErrorResponse` + bytes + elapsed time) is **not** an exact measurement of physical database cost: one query can emit multiple protocol messages (`ParseComplete`, `RowDescription`, `DataRow`, `CommandComplete`), queries can execute heavy work before failing (`statement_timeout` or rollback), parallel workers multiply backend work, and client retries repeat expensive work.
- **Reproduction Scenario:** Client sends a query that scans 50M rows for 9.9s and hits `statement_timeout`, or executes a multi-statement `BEGIN; INSERT ...; ROLLBACK;` inside a client retry loop.
- **Potential Impact:** Customer disputes over failed/retried queries or uncompensated compute burn.
- **Probability:** High under real OLTP/ORM workloads.
- **Proposed Solution:** Treat RU strictly as an **explicit, documented Customer Billing Heuristic**—not a claim of exact physical CPU attribution—kept strictly separate from **Usage Metering**, **Infrastructure Cost Accounting**, and **Abuse Enforcement**:
  1. **Protocol Usage Metering:** Record raw `(statements_completed, statements_errored, rows_affected, wire_bytes_out, copy_bytes_in, exec_wall_ms)` per session/window without deduplicating genuine client-initiated retries (clients pay for server work actually executed, while Gateway-internal wake retries never double-charge).
  2. **Clear Error/Abort Rule:** Published billing rule specifies how failed/rolled-back queries that executed backend work are metered (e.g., minimum 1 RU if backend execution started, bounded by elapsed work; pre-execution auth/syntax rejections before backend dispatch are free).
- **Alternative Solutions:** Pure compute-second + storage GB billing (simpler, but breaks the low-volume "Pay-Per-Million-Requests" UX for bursty apps).
- **Required Dependencies:** `internal/metering` protocol observer, published RU billing formula spec.
- **Performance Implications:** Integer atomic counters add <50ns per query frame.
- **Security Implications:** Prevents client-side multi-statement pipelining (`SELECT 1; SELECT 2; ...`) from bypassing statement metering.
- **Testing Procedure:** Execute single statements, multi-statement `'Q'` strings, Extended Query pipelines, `COPY IN/OUT`, rollbacks, timeouts, and Gateway wake-up retries; verify metered counts match documented rules.
- **Acceptance Criteria:** 100% deterministic match between metered counts and protocol events; Gateway internal wake/failover retries produce zero duplicate customer charges.

### RISK-26: CPU & Disk Metering Attribution
- **Severity:** P1
- **Technical Explanation:** Linux `cgroups v2` `cpu.stat` and `io.stat` capture total cgroup activity including PostgreSQL background writers, checkpointer, autovacuum workers, and parallel workers—not individual queries—and cannot distinguish Linux page-cache hits from physical NVMe reads accurately on a per-query basis or attribute delayed checkpoint writes cleanly.
- **Reproduction Scenario:** Query B runs a 1ms PK lookup while `autovacuum` or a dirty-buffer `CHECKPOINT` spikes inside the same tenant cgroup; attributing cgroup `io.stat` to Query B wrongly overbills it.
- **Potential Impact:** Unfair, unpredictable customer bills and billing disputes.
- **Probability:** High if raw `cgroup` deltas are wired directly into per-query billing.
- **Proposed Solution:** Enforce a clean **separation of concerns**:
  1. **Customer Billing (Predictable):** Derived strictly from deterministic **protocol-level query metrics** (statements, wire bytes, query wall time) + storage GB + `pg_stat_statements` periodic audit.
  2. **Infrastructure Cost Accounting (Internal FinOps):** Collect `cgroups v2` `cpu.stat`, `io.stat`, RSS, `pg_stat_bgwriter`, and `pg_stat_database` (`blks_hit` vs `blks_read`, `temp_bytes`) per tenant over 5-minute intervals purely to measure actual COGS and detect noisy-neighbor profiles.
  3. **Abuse Enforcement:** Trigger `cgroups v2` throttling or tier promotion when sustained `cgroup` CPU/IO exceeds plan limits, rather than unpredictably spiking a single query's RU charge.
- **Alternative Solutions:** Query `pg_stat_statements` (`shared_blks_read`, `total_exec_time`) periodically for heavy-tier usage billing (misses un-normalized dynamic SQL if `pg_stat_statements.max` overflows).
- **Required Dependencies:** `cgroups v2` stat collector, `pg_stat_statements`, Control Plane cost-accounting pipeline.
- **Performance Implications:** 5-minute `cgroup`/PG stat polling has negligible (<0.1%) overhead.
- **Security Implications:** Separates customer-visible billing logic from internal kernel telemetry.
- **Testing Procedure:** Run 1ms PK queries concurrently with forced `CHECKPOINT` and `VACUUM FULL`; verify PK query RU remains 1 RU while internal cost accounting records background I/O separately.
- **Acceptance Criteria:** Background `autovacuum`/`checkpoint` spikes cause 0% variance in customer per-query RU charges; internal COGS dashboard reconciles against Fly/R2 bills within 5%.

### RISK-27: RU Pricing Model Viability
- **Severity:** P1
- **Technical Explanation:** Publishing a "$/million RUs" price without empirically benchmarking actual Fly Cell COGS across realistic OLTP, idle-heavy, and analytical workloads risks negative unit economics.
- **Reproduction Scenario:** Customer sends millions of complex 9s analytical scans on a cheap per-million-RU flat rate, saturating a full `performance-2x` Cell while paying $2/month.
- **Potential Impact:** Unprofitable platform tiers and margin collapse.
- **Probability:** High if pricing weights aren't backed by Stage 1–2 benchmarks.
- **Proposed Solution:**
  - Defer final published RU pricing weights until Stage 1/2 benchmarks measure true COGS (Cell compute + R2 + WAL + Fly bandwidth) across: (a) 10,000 low-usage tenants, (b) high-QPS indexed OLTP, and (c) heavy analytical scans.
  - Design pricing tiers with: minimum monthly floor or free-tier quota caps, concurrency & `statement_timeout` bounds per tier, separate storage GB + backup/PITR retention billing, and mandatory promotion to Dedicated Compute Tiers above sustained CPU/RAM thresholds.
- **Alternative Solutions:** Pure CU-hour + active-seconds pricing (like Neon—sacrifices pay-per-request simplicity).
- **Required Dependencies:** Stage 1–2 empirical COGS benchmark suite.
- **Performance Implications:** Tier-based concurrency/timeout caps protect shared Cell latency.
- **Security Implications:** Hard free-tier quotas prevent crypto/compute abuse via free signups.
- **Testing Procedure:** Run financial simulation and live load tests modeling low-usage long-tail, high-QPS OLTP, and analytical abuse workloads against actual Fly + R2 invoices.
- **Acceptance Criteria:** Documented COGS model proving positive gross margin across all 3 workload archetypes under configured tier caps.

### RISK-28: Usage Event Reliability & Idempotent Ledger
- **Severity:** P1
- **Technical Explanation:** Keeping usage batches solely in Gateway RAM risks losing usage on crash/deploy, while Cloudflare Queues' at-least-once HTTP Pull delivery risks double-billing on retries or out-of-order arrivals.
- **Reproduction Scenario:** Gateway aggregates 14 seconds of RUs in RAM and suffers OOM/`SIGKILL`, or Cloudflare Queue visibility timeout expires mid-ack causing the batch to be processed twice.
- **Potential Impact:** Under-billing (lost revenue) or over-billing (customer disputes).
- **Probability:** Medium–High during rolling deploys and queue transient errors.
- **Proposed Solution:**
  1. Gateway flushes aggregated windows every 15s (or cleanly on `SIGTERM` drain) to a local disk-backed WAL (`bbolt`) **before** marking a window ready to ship, deleting local entries only after Queue `sendBatch` HTTP `200`.
  2. Each batch carries `(gateway_id, tenant_id, window_start_unix, seq_no)` and deterministic `idempotency_key = sha256(...)`.
  3. Control Plane Queue consumer (`cloudflare-go/v7` HTTP Pull API) writes to `usage_ledger` inside an ACID transaction (`INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`) **before** calling Queue `Ack(lease_id)`.
  4. Nightly reconciliation compares `usage_ledger` totals against Gateway counters and `pg_stat_statements` call counts for anomaly detection and dispute audits.
- **Alternative Solutions:** Direct synchronous RPC from Gateway to Control Plane DB (creates tight coupling and backpressure risk if Control Plane is momentarily down).
- **Required Dependencies:** Gateway local `bbolt` WAL volume/file, Cloudflare Queues HTTP Pull API, Control Plane PostgreSQL `usage_ledger` table.
- **Performance Implications:** Writing one 64 KB batch to `bbolt` every 15s adds <1ms I/O.
- **Security Implications:** Signed/authenticated internal queue payloads; immutable append-only audit ledger.
- **Testing Procedure:** `kill -9` Gateway mid-window and verify local `bbolt` recovery on restart; replay identical Queue messages 5 times and verify ledger row counts stay identical.
- **Acceptance Criteria:** 0% duplicate billing on 5x Queue replay; bounded loss window (`<= 1s` or `0` on graceful `SIGTERM`) under Gateway crash; 100% reconciliation auditability.

---

## P2 — Fly.io & Infrastructure Limitations

### RISK-29: Fly.io Machine Constraints
- **Severity:** P2
- **Technical Explanation:** Fly Machines enforce per-action rate limits (`1 req/s` base, `3 req/s` burst on mutations; `5 req/s` base, `10 req/s` burst on `GET`), regional capacity limits, private IPv6 (`6PN`) dependencies, and non-zero monthly cost for always-on Compute Cells and attached Volumes.
- **Reproduction Scenario:** Burst provisioning triggers 50 `CreateMachine` API calls in 5 seconds (`HTTP 429`), or a region runs out of `performance-2x` capacity during scale-out.
- **Potential Impact:** Failed auto-scaling or throttled Control Plane deployments.
- **Probability:** Medium during traffic spikes or multi-region expansion.
- **Proposed Solution:** Keep tenant start/stop inside running Cells (`0` Fly API calls); wrap all Fly Machines API calls in a token-bucket rate limiter honoring `Retry-After`; override Fly's `/init` defaults with `kill_signal = "SIGTERM"`, `kill_timeout = "300s"`, and `swap_size_mb = 2048` in `fly.cell.toml` (plus `PR_SET_CHILD_SUBREAPER` in `pg-cell-agent`); keep all `PGDATA` and `TMPDIR` strictly on `/vol` rather than small ephemeral rootfs `/`; pre-provision headroom Cells before utilization hits 75%; measure always-on Cell economics empirically in Stage 1; run backup/WAL Standby nodes on separate Fly Machines placed via `--volume-requires-unique-zone`.
- **Alternative Solutions:** Multi-provider Cell pool (Fly.io + bare-metal KVM/Hetzner for heavy Compute Cells if Fly regional capacity tightens).
- **Required Dependencies:** Fly Machines API client with rate limiting, multi-zone placement config.
- **Performance Implications:** Pre-warmed headroom Cells absorb tenant bursts without waiting for VM boots.
- **Security Implications:** Least-privilege Fly deploy tokens scoped per app.
- **Testing Procedure:** Stage 0 Fly validation: test Machine create/start/stop/replace, `HTTP 429` retry handling, `6PN` reachability across restarts, and regional placement flags.
- **Acceptance Criteria:** Verified zero unrecovered `429` errors under simulated fleet scaling; verified unique-zone separation between Pro Primary and Standby Machines.

### RISK-30: Regional Network Risks (`6PN`)
- **Severity:** P2
- **Technical Explanation:** Fly's private WireGuard network (`6PN`) can experience transient packet loss, cross-region latency spikes, DNS `.internal` staleness, or TCP resets between Gateways, Cells, and Standbys.
- **Reproduction Scenario:** `.internal` round-robin DNS returns a stopped/stale Machine IP, or transient packet loss stalls a Gateway-to-Cell connection pool causing unbounded goroutine queues.
- **Potential Impact:** Elevated p99 latency, stalled pools, or cascading Gateway memory growth.
- **Probability:** Medium over long-running production clusters.
- **Proposed Solution:** Route using immutable `<machine_id>.vm.<app-name>.internal` addresses paired with mTLS (automated cert rotation <30d); enforce TCP keepalives, exponential reconnect backoff with jitter, strict bounded request queues + fast-fail backpressure (`503` / `08006` when queue depth exceeds limit), and measure intra-/cross-region `6PN` RTT & packet loss continuously.
- **Alternative Solutions:** Flycast private proxy for HTTP internal control endpoints where built-in load balancing helps.
- **Required Dependencies:** Automated internal mTLS CA/rotation, `6PN` synthetic latency prober.
- **Performance Implications:** Bounded queues protect Gateway RAM at the expense of fast-failing overloaded traffic.
- **Security Implications:** All internal `6PN` control and Postgres bridges encrypted with mutually authenticated TLS.
- **Testing Procedure:** Inject 5% packet loss and 200ms jitter via `tc netem` between Gateway and Cell; assert bounded Gateway memory and clean recovery when network clears.
- **Acceptance Criteria:** Zero Gateway OOMs under `6PN` blackhole/loss tests; automated recovery within 5s of network restoration.

### RISK-31: Cell Capacity Management
- **Severity:** P2
- **Technical Explanation:** Without strict admission policies, placing too many large or active tenants on one Cell exhausts CPU, RAM, page cache, `ext4` disk, or backend connections.
- **Reproduction Scenario:** Scheduler places 5 heavy analytical tenants onto the same 8 GB Cell, thrashing the Linux page cache and degrading p99 latency for 80 small tenants.
- **Potential Impact:** Severe multi-tenant noisy-neighbor degradation.
- **Probability:** High at scale without capacity-aware scheduling.
- **Proposed Solution:** Define explicit Cell capacity limits per SKU (e.g., 8 GB Cell: max 80 active PG processes, max 500 dormant on-disk clusters, max 75% `ext4` utilization, max 1,200 backends, target CPU/memory oversubscription ratios); score Cells in Control Plane scheduler by free RAM, free disk, active tenant load, and workload class; auto-evict idle DBs and promote heavy DBs (`>5 GB` or sustained high CPU) to larger/Dedicated Cells.
- **Alternative Solutions:** Static shard assignment (leads to hot-shard skew over time).
- **Required Dependencies:** Real-time Cell telemetry heartbeat + bin-packing scheduler in Control Plane.
- **Performance Implications:** Balanced Cell load preserves predictable p95/p99 query latency.
- **Security Implications:** Prevents resource exhaustion across co-located tenants.
- **Testing Procedure:** Simulate uneven workload growth across 5 Cells; verify scheduler stops admitting to Cells >75% disk/RAM and automatically migrates/evicts excess load.
- **Acceptance Criteria:** Zero Cells exceed 85% sustained memory or 80% disk under synthetic growth tests.

---

## P2 — Control Plane & API Design

### RISK-32: Control Plane Reliability
- **Severity:** P2
- **Technical Explanation:** A single-instance Control Plane or single metadata DB creates a platform-wide SPOF; partial provisioning or deletion during migration causes metadata/data-plane drift.
- **Reproduction Scenario:** Control Plane restarts mid-`POST /databases` after reserving a cluster on Cell #1 but before committing the tenant row, leaking an orphaned cluster forever.
- **Potential Impact:** Provisioning failures, leaked storage, and platform-wide control outage.
- **Probability:** Medium–High over normal deployments and restarts.
- **Proposed Solution:** Deploy Control Plane API as 3+ stateless Go instances across zones backed by a 3-node HA PostgreSQL metadata cluster (with automated backups + audit log); enforce transactional outbox + state machine (`PROVISIONING -> ACTIVE -> MIGRATING -> DELETING -> DELETED`) with resource allocation locks, provisioning rollback, and a periodic `control-reconcile-queue` reconciliation sweeper comparing Control Plane state against Cell inventories.
- **Alternative Solutions:** Raft-embedded metadata (e.g., `dqlite`/`etcd`—less flexible for rich relational billing/audit queries than HA Postgres).
- **Required Dependencies:** 3-node HA Metadata Postgres, `control-reconcile-queue`.
- **Performance Implications:** Control Plane read routes cached briefly in Gateway memory (invalidated on epoch change).
- **Security Implications:** Full immutable audit log of all Control Plane mutations.
- **Testing Procedure:** Kill Control Plane instances randomly during concurrent provision/migrate/delete storms; run reconciler and assert eventual consistency with zero orphan `PGDATA` dirs.
- **Acceptance Criteria:** 100% metadata/Cell consistency after crash-recovery reconciliation; Control Plane survives single-instance and single-zone loss with zero API downtime.

### RISK-33: Database Provisioning
- **Severity:** P2
- **Technical Explanation:** Duplicate API retries, disk-full mid-provision, `FICLONE`/rename failures, or agent disconnects can create duplicate tenant IDs or broken clusters.
- **Reproduction Scenario:** Client times out and retries `POST /databases` without idempotency -> two databases provisioned or partial `PGDATA` left behind.
- **Potential Impact:** Broken user onboarding and orphaned storage leaks.
- **Probability:** High under network retries.
- **Proposed Solution:** Require/support `Idempotency-Key` on provisioning requests; enforce `UNIQUE (tenant_id)` and `UNIQUE (system_identifier)` in Control DB; use two-phase Cell allocation with automatic rollback + cleanup queue on agent disconnect or disk-full errors; run a readiness `SELECT 1` + `SCRAM` login verification + credential rotation generation before returning `READY`.
- **Alternative Solutions:** Synchronous blocking provisioning without rollback (leaks storage on timeout).
- **Required Dependencies:** Control DB unique constraints, `pg-cell-agent` claim/rollback RPC.
- **Performance Implications:** Idempotency lookup adds <2ms to API response.
- **Security Implications:** Cryptographically random 256-bit password/key generation; credentials never persisted in plaintext logs.
- **Testing Procedure:** Fire duplicate `POST /databases` with same `Idempotency-Key`, disconnect agent mid-provision, and simulate full Cell disk during claim.
- **Acceptance Criteria:** Duplicate requests return identical database metadata safely; interrupted provisions leave 0 orphaned directories.

### RISK-34: API & Developer Experience
- **Severity:** P2
- **Technical Explanation:** Users expect standard Postgres URIs, TLS out of the box, clear errors when a database is waking/quota-exceeded, and complete lifecycle APIs.
- **Reproduction Scenario:** Cold DB takes 2s to wake or hits storage quota, and client receives an opaque `connection reset by peer` instead of actionable PostgreSQL error/status.
- **Potential Impact:** Poor developer adoption and difficult debugging.
- **Probability:** High if UX edge cases are ignored.
- **Proposed Solution:** Provide standard TLS connection strings (`postgres://...?sslmode=require`), pooled & direct endpoints, REST/CLI APIs for health status, RU/storage metrics, backups, PITR cloning, migrations, and deletion; configure Gateway to return standard PostgreSQL `ErrorResponse` codes (`57P03` / `53100` with human-readable wake/quota messages) when wake-up times out or quotas block writes.
- **Alternative Solutions:** Custom proprietary client protocol only (breaks standard ORMs and `psql`).
- **Required Dependencies:** Control Plane REST API, Gateway `ErrorResponse` formatter, SDKs/docs.
- **Performance Implications:** Minimal formatting overhead.
- **Security Implications:** TLS required by default (`sslmode=require` minimum); scoped API tokens.
- **Testing Procedure:** Test `psql`, Prisma, and Node `pg` against waking, quota-full, and deleting states; verify clear SQLSTATE messages.
- **Acceptance Criteria:** Standard Postgres tools connect via TLS URI with zero custom drivers; clear SQLSTATE messages verified across all error conditions.

---

## P2 — Performance & Scalability Risks

### RISK-35: Gateway Bottlenecks
- **Severity:** P2
- **Technical Explanation:** TLS handshakes, goroutine growth, `pgproto3` allocation pressure, large `DataRow` streaming, and `COPY` pipelines can exhaust Gateway CPU/RAM.
- **Reproduction Scenario:** 10,000 idle TLS connections + 50 concurrent 100 MB `COPY OUT` streams allocate unbounded read/write buffers in Go heap.
- **Potential Impact:** Gateway OOM or severe tail-latency degradation for all tenants.
- **Probability:** Medium–High under high concurrency.
- **Proposed Solution:** Stream wire frames via pooled `sync.Pool` byte buffers without buffering full `DataRow`/`COPY` results in RAM; enforce bounded per-connection send queues + backpressure; benchmark concurrent connections (1k, 10k), TLS handshake CPU, goroutine RSS, and `COPY`/pipeline throughput in Stage 1–2; scale Gateways horizontally via Fly Anycast across regions.
- **Alternative Solutions:** Offload TLS termination or run multiple Gateway apps per region.
- **Required Dependencies:** `sync.Pool` buffer reuse, Go `pprof` benchmark harness.
- **Performance Implications:** Streaming zero-copy/pooled buffers keep per-connection memory `<16 KB`.
- **Security Implications:** Prevents unbounded heap growth DoS via slow-reading clients (`SetWriteDeadline`).
- **Testing Procedure:** Benchmark 10,000 concurrent TLS connections + concurrent `COPY` streams + pipeline bursts while profiling Go heap/goroutines.
- **Acceptance Criteria:** Linear memory scaling `<20 KB/conn` at 10,000 connections; zero Gateway OOMs under slow-client `COPY` backpressure.

### RISK-36: Database Wake-Up Bottlenecks
- **Severity:** P2
- **Technical Explanation:** Cold/crash-recovery startups, large catalogs/extensions, and thundering herds (1,000 simultaneous requests hitting a sleeping tenant) can saturate Cell CPU/IOPS.
- **Reproduction Scenario:** 500 serverless workers hit a sleeping tenant at once; if wake-ups aren't coalesced and queue-bounded, the Cell spawns redundant work or hits file/memory limits.
- **Potential Impact:** Multi-second wake-up stalls and cascading timeouts.
- **Probability:** High for spiky serverless apps.
- **Proposed Solution:** Coalesce concurrent wake-up requests via `singleflight` + bounded hold queue per waking tenant (e.g., max 200 queued sockets; excess fail fast with `53300` + `Retry-After`); benchmark real startup times across warm stop, crash recovery (`WAL` replay), large catalogs (1,000 tables), and extensions (`pgvector`) measuring p50/p95/p99 separately for connection establishment vs first query; rate-limit simultaneous Cell cold boots (`max_concurrent_starts = 5`).
- **Alternative Solutions:** Keep active paid-tier tenants warm continuously (configurable `idle_timeout = 0` to disable scale-to-zero).
- **Required Dependencies:** `golang.org/x/sync/singleflight`, bounded Semaphore queues in Gateway and `pg-cell-agent`.
- **Performance Implications:** Coalescing turns 1,000 wake requests into 1 process spawn; semaphore prevents disk thrashing during multi-tenant wake storms.
- **Security Implications:** Bounded hold queue prevents slow-wake memory exhaustion on Gateway.
- **Testing Procedure:** Run Benchmark Group B: 100, 500, and 1,000 concurrent wake-ups across warm and post-crash DBs, logging p50/p95/p99 start and first-query times.
- **Acceptance Criteria:** Verified single process boot per 1,000 concurrent wake requests; bounded Gateway memory; documented p50/p95/p99 startup latencies.

### RISK-37: Storage Performance
- **Severity:** P2
- **Technical Explanation:** Concurrent WAL writes, checkpoints, random reads, and large index builds across many co-located `ext4` clusters can contend on shared NVMe IOPS and `fsync` queues.
- **Reproduction Scenario:** 10 tenants run heavy `CREATE INDEX` and `CHECKPOINT` simultaneously on one Cell volume, spiking `fsync` latency to 100ms+ for neighboring OLTP queries.
- **Potential Impact:** P99 query latency spikes on shared Cells.
- **Probability:** Medium–High on write-heavy shared Cells.
- **Proposed Solution:** Benchmark `ext4` random read/write, sequential write, `fsync` latency, concurrent WAL writes, checkpoints, and R2 backup/restore throughput in Stage 0–1; tune `checkpoint_completion_target = 0.9`, `checkpoint_timeout = 15min`, `wal_compression = zstd`; enforce per-tenant `cgroups v2` `io.max` (IOPS + MB/s ceilings) so noisy I/O tenants are throttled and promoted to Dedicated Cells.
- **Alternative Solutions:** Place `pg_wal` on a separate dedicated NVMe mount or promote write-heavy workloads sooner.
- **Required Dependencies:** `cgroups v2` `io.max` (`blkio`), `fio` + `pgbench` Stage 0/1 benchmark suite.
- **Performance Implications:** `io.max` protects shared OLTP p99 at the cost of capping noisy-neighbor bulk write rates.
- **Security Implications:** Prevents disk I/O starvation attacks.
- **Testing Procedure:** Run multi-tenant `pgbench` TPC-B alongside simultaneous `CREATE INDEX` and `pg_basebackup` on a Cell; record p50/p95/p99 `fsync` and transaction latency.
- **Acceptance Criteria:** Documented empirical IOPS/`fsync` profile; OLTP neighbor p99 stays within defined SLA while noisy tenant runs `CREATE INDEX`.

### RISK-38: Large Tenant Handling
- **Severity:** P2
- **Technical Explanation:** Large databases (>5–10 GB) or analytical workloads have slow cold restores, large RAM/page-cache footprints, and high connection/CPU demands unsuitable for dense shared Cells.
- **Reproduction Scenario:** A 40 GB tenant grows inside a shared 80 GB Cell, consuming half the volume and evicting all other tenants' hot working sets from the Linux page cache.
- **Potential Impact:** Exhausts shared Cell disk/RAM and degrades every neighbor.
- **Probability:** High as user databases grow organically.
- **Proposed Solution:** Classify workloads continuously (disk size, active working set, sustained CPU/IOPS, connection pool concurrency); enforce hard shared-Cell thresholds (e.g., max 5 GB DB size, max 1 vCPU sustained, max 512 MB RAM cgroup); automatically trigger live physical-replication migration (RISK-20) to promote exceeding tenants onto **Dedicated Cells / Dedicated Fly Machines** with tailored volume sizes and `shared_buffers`.
- **Alternative Solutions:** Require manual tier upgrade before allowing DB growth past 5 GB (enforced via project quota until upgrade).
- **Required Dependencies:** Telemetry classifier, Control Plane live migrator, Dedicated Cell Fly app config.
- **Performance Implications:** Keeps shared Cells small, fast, and predictable while giving large tenants dedicated page cache and NVMe IOPS.
- **Security Implications:** Dedicated VM provides full Firecracker hardware isolation for large enterprise tenants.
- **Testing Procedure:** Grow a tenant continuously under load past the shared-Cell threshold; assert automatic promotion triggers live migration to a Dedicated Cell with zero lost commits.
- **Acceptance Criteria:** Automated detection and live promotion without data loss; shared Cell disk/cache returns cleanly below threshold.

---

## P2 — Operations & Observability

### RISK-39: Monitoring
- **Severity:** P2
- **Technical Explanation:** Operating multi-tenant databases without granular per-tenant and per-Cell visibility makes outages, wraparound, lag, and billing drift invisible until customers complain.
- **Reproduction Scenario:** Silent backup corruption or rising `datfrozenxid` goes unnoticed for weeks until wraparound shutdown or failed restore.
- **Potential Impact:** Preventable outages and unverified backup health.
- **Probability:** High without structured telemetry.
- **Proposed Solution:** Export Prometheus/OpenMetrics from `pg-cell-agent`, `pg-gateway`, `pg-wal-sink`/`pg-standby`, and `pg-control-plane` covering: PG process health/starts/crashes, per-tenant CPU/RSS/disk (`quotactl`), WAL generation rate & archive lag, replication `write`/`flush`/`apply` lag, last verified backup & `pg_amcheck` restore drill status, connection & active query counts, long-running txns, vacuum progress, `age(datfrozenxid)`, Cell capacity, Gateway/wake-up p50/p95/p99, Queue backlog, and billing reconciliation drift.
- **Alternative Solutions:** External agent polling only (misses process-level cgroup and Gateway wake-up telemetry).
- **Required Dependencies:** Prometheus / VictoriaMetrics + Grafana + OpenTelemetry structured logs.
- **Performance Implications:** In-process metrics scraping `<0.5%` CPU.
- **Security Implications:** Strip SQL literals and PII from all telemetry labels and traces.
- **Testing Procedure:** Validate every metric populates accurately during synthetic load, crash, backup, and failover tests.
- **Acceptance Criteria:** 100% coverage of all 22 audit monitoring signals (issue.md #39) in staging dashboards.

### RISK-40: Alerting
- **Severity:** P2
- **Technical Explanation:** Monitoring without actionable, noise-free PagerDuty/Slack alerting delays incident response during disk exhaustion, standby lag, or XID wraparound.
- **Reproduction Scenario:** R2 uploads fail silently for 48 hours due to expired credentials, leaving all backups stale without paging engineers.
- **Potential Impact:** Unrecoverable data gaps during a subsequent host failure.
- **Probability:** Medium–High without automated alert rules.
- **Proposed Solution:** Configure severity-tiered alert rules covering all 15 conditions in `issue.md #40`: Cell disk >80% (warn) / >90% (page), Cell memory pressure/OOMs, unexpected PG crash loops, startup timeouts, abnormal WAL spikes, WAL archive lag >30s, standby replication lag >10MB or standby disconnected, backup or weekly restore-drill failures, `age(datfrozenxid) > 120M`, sync standby/quorum loss, R2 upload errors, Control Plane DB unavailability, Queue backlog >10k/age >5m, and abnormal tenant resource spikes.
- **Alternative Solutions:** Manual log review (unacceptable for production SLA).
- **Required Dependencies:** Alertmanager / Grafana Alerting + PagerDuty/Slack webhook routing.
- **Performance Implications:** Evaluated externally by Prometheus/Alertmanager (0 Cell overhead).
- **Security Implications:** Alerts mask tenant PII while providing internal `tenant_id`/`cell_id` trace IDs.
- **Testing Procedure:** Trigger synthetic fault alerts (stop R2 upload, fill test Cell to 85%, disconnect standby, pause Queue consumer) and verify alert firing within SLA (<2m).
- **Acceptance Criteria:** All 15 alert rules verified end-to-end with documented runbook links.

### RISK-41: Disaster Recovery
- **Severity:** P2
- **Technical Explanation:** Untested disaster recovery procedures fail during real regional outages, R2 outages, or mass corruptions.
- **Reproduction Scenario:** Regional Fly outage takes down both primary and standby Cells in `iad`, or Control Plane DB fails, or an operator accidentally deletes a tenant.
- **Potential Impact:** Prolonged multi-tenant outage or permanent data loss.
- **Probability:** Low–Medium per event, catastrophic impact.
- **Proposed Solution:** Maintain and regularly drill automated DR playbooks for all 12 failure modes in `issue.md #41`:
  1. *Complete Cell Loss:* Pro Tier -> automatic standby promotion; Standard Tier -> cross-Cell R2 restore.
  2. *Complete Region Loss:* Multi-region standby (optional Geo-Pro) or cross-region R2 restore into healthy Fly region (`ord`/`ewr`).
  3. *Temporary R2 Outage:* Cells buffer WAL locally up to disk reserve + standby retains WAL (`max_slot_wal_keep_size` alert) until R2 recovers; alert triggers if buffer exceeds 50%.
  4. *Standby / WAL Ring Failure:* Pro Tier alerts immediately; policy governs strict commit block vs explicit user-approved async fallback.
  5. *Control Plane DB Failure:* 3-node HA Postgres auto-failover + continuous R2 WAL-G/pgBackRest backup + Gateways continue routing active sessions via cached routes within lease TTL.
  6. *Accidental Tenant Deletion:* 7-day soft-delete state before R2 DEK crypto-shredding + PITR clone restoration.
  7. *Corrupted Snapshot / WAL:* `pg_verifybackup` catches corruption before publishing; restore falls back to prior verified parent base backup + WAL chain.
  8. *Stale Replica Promotion / Failed Migration / Credential Compromise / Mass Outage:* Epoch fencing prevents stale promotion; migrations abort cleanly pre-cutover; rapid bulk credential & DEK rotation endpoints; staged mass-Cell recovery prioritizing paid/active tiers.
- **Alternative Solutions:** Manual ad-hoc CLI recovery (slow and error-prone under incident stress).
- **Required Dependencies:** Automated DR runbook scripts, multi-region R2 replication (if multi-region SLA offered), Control Plane HA backups.
- **Performance Implications:** Soft-delete retention retains encrypted R2 objects for 7 days (negligible `$0.015/GB` cost).
- **Security Implications:** Soft-deleted data stays encrypted and inaccessible via revoked client credentials until hard crypto-shredding.
- **Testing Procedure:** Execute quarterly Chaos/GameDay DR drills covering Cell loss, region evacuation, simulated R2 403/503 outage, Control Plane failover, and accidental-delete PITR restore.
- **Acceptance Criteria:** Successful execution of all DR GameDay scenarios within documented RTO/RPO bounds prior to general availability.
