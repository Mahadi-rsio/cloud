# Principal Database Engineer — Complete Audit Resolution Register (Risks 01–41)

> **Reference Audit:** [issue.md](file:///workspaces/cloud/experimental-db/issue.md)  
> **Target Design:** [plan.md](file:///workspaces/cloud/experimental-db/plan.md)  
> **Coverage:** Complete resolution of every **P0**, **P1**, and **P2** item (`RISK-01` through `RISK-41`) using verified Fly.io, Cloudflare R2, Cloudflare Queues, and PostgreSQL 17 behavior.

---

## Part 1: P0 — Critical Architectural Risks (Must Solve Before Production Code)

### RISK-01: PostgreSQL Template Cloning & Duplicate `system_identifier`
- **Severity:** **P0**
- **Technical Explanation:** `initdb` writes a unique 64-bit `system_identifier` into `global/pg_control`. Cloning a single `PGDATA` via `FICLONE` or file copy duplicates `system_identifier` across tenants, breaking WAL validation and backup lineage.
- **Reproduction Scenario:** Clone one `PGDATA` twice (`tenant_a`, `tenant_b`). Both report the same `Database system identifier` in `pg_controldata`. Supplying a WAL file from `tenant_a` to `tenant_b` succeeds instead of failing, silently corrupting pages.
- **Potential Impact:** Cross-tenant WAL corruption and invalid PITR recovery.
- **Probability:** **100%** if `PGDATA` is cloned directly.
- **Proposed Solution:** Replace cloning with a **Pre-Initialized `initdb` Cluster Pool**: a low-priority (`nice -n 19`) background goroutine on each Cell runs `initdb --auth=scram-sha-256 --encoding=UTF8` to maintain 20 clean, stopped clusters in `/vol/pool/`. Provisioning claims a cluster via atomic `os.Rename()` and replenishes asynchronously.
- **Alternative Solutions:** (a) On-demand `initdb` (~500ms latency spike per creation); (b) `pg_resetwal` (does not safely regenerate `system_identifier`).
- **Required Dependencies:** ~900 MB reserved `ext4` disk space on each Cell for 20 pooled clusters.
- **Performance Implications:** Provisioning claim takes <5ms with zero foreground `initdb` CPU contention.
- **Security Implications:** Zero shared `PGDATA` or `system_identifier` across tenants.
- **Testing Procedure:** Provision 1,000 clusters concurrently; assert 1,000 distinct `system_identifier` values via `pg_controldata` and test cross-tenant WAL rejection.
- **Acceptance Criteria:** 100% unique `system_identifier` across all clusters; 0ms impact on active tenant p99 during pool replenishment.

### RISK-02: `FIEMAP`-Based Physical Delta Backup Corruption Risks
- **Severity:** **P0**
- **Technical Explanation:** `FIEMAP` skips Linux delayed-allocation (`delalloc`) blocks unless `FIEMAP_FLAG_SYNC` is set, and scanning live files without `pg_backup_start()`/`pg_backup_stop()` captures torn 8 KB pages and inconsistent timelines.
- **Reproduction Scenario:** Run `FIEMAP` scan during active `pgbench` writes; restore and start Postgres -> `PANIC: invalid page header` or lost rows.
- **Potential Impact:** Silent backup corruption and unrecoverable snapshots.
- **Probability:** **High** under active writes.
- **Proposed Solution:** **Eliminate `FIEMAP` delta scraping.** Use **PostgreSQL 17 native `pg_basebackup`** (`-Ft -Z zstd --checkpoint=fast --manifest=yes`) and **PG17 native `--incremental`** (`summarize_wal = on`) reconstructed via `pg_combinebackup`.
- **Alternative Solutions:** `pg_dump`/`pg_restore` (rebuilds B-Tree indexes slowly on restore); LVM/ZFS snapshots (unavailable on Fly `ext4`).
- **Required Dependencies:** PostgreSQL 17 (`summarize_wal = on`, `pg_basebackup`, `pg_combinebackup`), `zstd`, 2.2x temporary disk space check during restore.
- **Performance Implications:** Sequential tar/zstd streaming at native NVMe speed; `--incremental` backs up only changed 8 KB blocks safely.
- **Security Implications:** Every file checksummed (SHA-256) in `backup_manifest` before R2 publication.
- **Testing Procedure:** Execute `pgbench` concurrently with full and `--incremental` `pg_basebackup`, kill VM mid-run, restore via `pg_combinebackup`, and run `pg_amcheck`.
- **Acceptance Criteria:** Zero `pg_amcheck` errors and 100% transaction consistency across 50 crash-during-backup tests.

### RISK-03 & RISK-04: Physical WAL Replication, `RPO=0` & NATS JetStream Semantics
- **Severity:** **P0**
- **Technical Explanation:** `pglogrepl` in logical mode does not replicate DDL or physical blocks, and NATS JetStream does not implement PostgreSQL's `StandbyStatusUpdate` (`FlushLSN`) synchronous standby feedback protocol required by `synchronous_standby_names`.
- **Reproduction Scenario:** Commit transaction when async queue buffer hasn't flushed to remote disk; kill primary VM 20ms later -> committed row vanishes.
- **Potential Impact:** Silent loss of acknowledged commits despite `RPO=0` claim.
- **Probability:** **High** on abrupt host failure.
- **Proposed Solution:** Define two explicit durability tiers:
  1. **Standard Tier (Async, Honest `RPO ≤ 5s`):** `pglogrepl` **Physical Replication Mode** (`pglogrepl.PhysicalReplication`) streaming to local buffer + R2 every 5s and on drain.
  2. **Pro Tier (`RPO = 0`):** `pg-cell-agent` acts as a local synchronous replication standby (`synchronous_standby_names = 'pg_cell_sync'`), forwarding `XLogData` over `6PN` to a **3-node Go WAL Sink Cluster** on 3 separate Fly hosts (`--volume-requires-unique-zone`), returning `StandbyStatusUpdate{WALFlushPosition}` to Postgres **only after 2/3 nodes `fsync()`** the frame to NVMe.
- **Alternative Solutions:** Full standby `postgres` process per tenant (prohibitive RAM overhead for hundreds of tenants per Cell).
- **Required Dependencies:** 3-node `pg-wal-sink` Fly app deployed across 3 unique zones/hosts with NVMe volumes.
- **Performance Implications:** Adds ~1–3ms intra-region `6PN` RTT + NVMe `fsync` per `COMMIT` on Pro Tier; 0ms on Standard Tier.
- **Security Implications:** WAL frames include `tenant_id`, `epoch`, and `CRC32C` checksum; stale epochs rejected at WAL Sink.
- **Testing Procedure:** External ledger `pgbench` test while executing `kill -9` on active Cell and 1 of 3 WAL Sink nodes simultaneously; test recovery under 2-node quorum loss (verify commits block safely rather than committing un-replicated data).
- **Acceptance Criteria:** Zero lost client-acknowledged commits on Pro Tier across 20 abrupt kill tests; p50/p99 commit latency measured and published.

### RISK-05: Shared Compute Cell Failure Domain & Isolation Boundaries
- **Severity:** **P0**
- **Technical Explanation:** Multiple `postgres` clusters inside one Fly Machine share a Linux guest kernel, `ext4` volume, network interface, and memory pressure.
- **Reproduction Scenario:** Tenant A opens 200 connections or triggers a huge hash join, pushing Cell RAM to 100% and causing Linux OOM killer to kill `pg-cell-agent` or Tenant B.
- **Potential Impact:** Multi-tenant Cell outage.
- **Probability:** **High** without strict kernel/cgroup boundaries.
- **Proposed Solution:** Inside the Firecracker guest kernel: (1) Per-tenant UID (`10000+slot`) + `0700` `PGDATA` + `/proc` mounted `hidepid=2`; (2) Dedicated `cgroups v2` per tenant with `memory.max`, `memory.oom.group = 1` (OOM kills only that tenant), `pids.max = 64`, `cpu.max`, `io.max`; (3) Reserve 20% RAM (`memory.low`) for OS + `pg-cell-agent`; (4) Admission cap of 80–100 active processes per 8 GB Cell.
- **Testing Procedure:** Run memory-exhaustion, fork-bomb, and CPU-burn queries in Tenant A while Tenant B runs `pgbench`.
- **Acceptance Criteria:** Tenant A's cgroup terminates cleanly via `oom.group`; Tenant B p99 latency and `pg-cell-agent` remain unaffected.

---

## Part 2: P1 — PostgreSQL Engineering Risks

### RISK-06: Process-Per-Tenant Lifecycle Management
- **Severity:** **P1**
- **Technical Explanation:** Process crashes, agent restarts, stale `postmaster.pid`, orphaned Unix sockets, and concurrent wake/shutdown races can corrupt `PGDATA` or leave tenants unreachable.
- **Proposed Solution:**
  - Acquire non-blocking `unix.Flock(LOCK_EX | LOCK_NB)` on `PGDATA/agent.lock` before starting `postgres` (prevents dual primaries mathematically).
  - On `pg-cell-agent` restart, scan `/proc` + `agent.lock` to re-adopt live tenant processes without interrupting traffic; purge stale `postmaster.pid` / `.s.PGSQL.5432` only when no PID holds the flock.
  - Strict FSM (`STOPPED -> STARTING -> RUNNING -> DRAINING -> STOPPING -> STOPPED`) wrapped in `singleflight` + per-tenant mutex.
- **Testing Procedure:** Kill `pg-cell-agent` with `SIGKILL` while 20 tenants run; restart agent and verify adoption + 500 concurrent wake-ups.
- **Acceptance Criteria:** Zero dual-primary launches; 100% adoption of running PG processes across agent restarts.

### RISK-07: Scale-to-Zero & Cooperative Drain
- **Severity:** **P1**
- **Technical Explanation:** Stopping a DB with active locks, prepared transactions (`2PC`), `LISTEN`, `COPY`, or millisecond-late arrivals drops client connections or blocks recovery.
- **Proposed Solution:**
  - Block scale-to-zero unless `pg_stat_activity` has 0 active/idle-in-tx sessions, `pg_locks` has 0 advisory locks, `pg_prepared_xacts` is empty, and `pg_listening_channels()` is empty.
  - Two-phase cooperative drain: Agent asks Gateway to enter `DRAINING` (holding new sockets in memory) -> runs `CHECKPOINT` + WAL flush -> `pg_ctl stop -m fast` -> confirms `STOPPED` (or immediately wakes if Gateway buffered a late arrival).
- **Acceptance Criteria:** Zero `ECONNRESET` across 1,000 randomized concurrent wake/drain races.

### RISK-08: Autovacuum & Transaction ID Wraparound
- **Severity:** **P1**
- **Technical Explanation:** Short wake windows (<60s `autovacuum_naptime`) starve autovacuum, allowing dead tuples and `datfrozenxid` age to grow unchecked.
- **Proposed Solution:** Dedicated **Maintenance Scheduler** monitors `age(datfrozenxid)`, `mxid_age(datminmxid)`, and dead tuple % on wake-up and every 5 minutes; blocks scale-to-zero and forces `VACUUM (FREEZE)` when thresholds exceed 50% of `autovacuum_freeze_max_age` or 20% dead tuples. Pre-sleep `VACUUM` remains an optimization only.
- **Acceptance Criteria:** `age(datfrozenxid)` stays bounded below 150M under sustained write + rapid sleep cycles.

### RISK-09: PostgreSQL Memory Configuration
- **Severity:** **P1**
- **Technical Explanation:** `work_mem` applies *per query operator* (sorts/hashes), and parallel workers/extensions multiply per-backend memory past `shared_buffers = 16MB`.
- **Proposed Solution:** Configure `max_connections = 15`, `work_mem = 4MB`, `maintenance_work_mem = 32MB`, `max_parallel_workers_per_gather = 1` (on shared tier), enforce per-tenant `cgroups v2` `memory.max`, and enforce Cell admission control based on active memory reservations.
- **Acceptance Criteria:** Benchmark RSS under heavy sort/join workloads; zero host-level OOMs at max admitted tenant count.

### RISK-10: PostgreSQL Configuration Isolation
- **Severity:** **P1**
- **Technical Explanation:** Tenants must not escalate to `SUPERUSER`, load arbitrary `.so` libraries, or execute `COPY ... FROM PROGRAM`.
- **Proposed Solution:** Tenants receive non-superuser `app_owner`. Load `supautils` in `shared_preload_libraries` to allow safe extension creation (`vector`, `pg_stat_statements`) while blocking `COPY PROGRAM`, `LOAD`, untrusted languages (`plpythonu`), and protected GUCs (`data_directory`, `archive_command`). Config files owned `0600` by `root` outside tenant UID access.
- **Acceptance Criteria:** Automated security test verifying rejection of `COPY PROGRAM`, `LOAD`, `pg_read_file('/etc/passwd')`, and `ALTER SYSTEM`.

### RISK-11: Prepared Statement Virtualization
- **Severity:** **P1**
- **Technical Explanation:** Transaction pooling breaks ORMs unless Extended Query protocol (`Parse`, `Bind`, `Describe`, `Execute`, `Close`, `Sync`, `Flush`, unnamed `""` statements/portals, DDL invalidation) and session-state commands are handled cleanly.
- **Proposed Solution:** Full `pgproto3` virtual statement table per client session (`stmt -> hash`) with backend statement cache, unnamed statement pinning/rewriting within `Parse..Sync` pipelines, DDL invalidation re-prepare, and **automatic Session Pinning** for `TEMP TABLE`, session `SET`, `pg_advisory_lock`, `LISTEN`, and `2PC` until `DISCARD ALL`.
- **Acceptance Criteria:** Benchmark Group E passes 100% against Prisma, Drizzle, `pgx`, `sqlx`, JDBC, `node-postgres`, and `psql`.

### RISK-12: PostgreSQL Connection Pooling
- **Severity:** **P1**
- **Technical Explanation:** Connection storms or leaked pinned sessions can exhaust a tenant's `max_connections = 15` or the Cell's total backend slots.
- **Proposed Solution:** Gateway terminates and multiplexes client TCP connections in Go goroutines (~2 KB each), enforcing per-tenant client limits (e.g., 500 pooled / 10 pinned), transaction wait timeouts (5s), and backend pool limits per Cell (`max_backends = 1500`).
- **Acceptance Criteria:** 1,000 concurrent client connections multiplex cleanly over 10 backend sockets without starving other tenants.

---

## Part 3: P1 — Storage & Data Durability Risks

### RISK-13 & RISK-14: Fly `ext4` Volume Compatibility & Storage Accounting
- **Severity:** **P1**
- **Technical Explanation:** Fly Volumes are strictly `ext4` (no native XFS/reflink) and **cannot be shrunk** after extension. Reflink extent fragmentation/accounting risks disappear once reflinks are removed from Stages 1–5.
- **Proposed Solution:** Build on standard `ext4` with fixed **80 GB Cell Volumes** (`snapshot_retention = 7`), explicit `statfs`/directory-size tenant quotas, and Deep Freeze eviction to R2 rather than unbounded volume resizing. Re-evaluate CoW/reflinks only in Stage 12 if bare-metal XFS hosts are ever introduced.
- **Acceptance Criteria:** Verified on real Fly.io `ext4` volume; Cell stays below 80% disk utilization under churn tests.

### RISK-15 & RISK-16: Cloudflare R2 Reliability & PITR
- **Severity:** **P1**
- **Technical Explanation:** Interrupted multipart uploads, partial WAL segments, or missing manifest tracking break PITR.
- **Proposed Solution:** Two-phase atomic backup publish: upload payload (`If-None-Match: *` on `CompleteMultipartUpload`) + SHA-256 `backup_manifest` -> verify -> update `manifest.json` via `If-Match: <etag>`. Envelope encryption per tenant (DEK/KEK). Track `min_required_wal_seg` and timeline history files in `manifest.json` for exact timestamp/LSN PITR via `pg_combinebackup` + `recovery.signal`. Weekly automated restore drills + `pg_amcheck`.
- **Acceptance Criteria:** Successful PITR recovery to an exact pre-`DROP TABLE` timestamp in automated tests.

### RISK-17: Storage Quotas & Disk Exhaustion
- **Severity:** **P1**
- **Technical Explanation:** One tenant filling the shared `ext4` volume freezes WAL writes for all other tenants on the Cell.
- **Proposed Solution:** Monitor per-tenant directory size (data + WAL + temp) every 30s; enforce `ALTER DATABASE ... SET default_transaction_read_only = on` at 100% tenant quota + terminate runaway inserts. Reserve **2 GB `/vol/.cell_ballast`** on Cell init; trigger evictions at **80%**, block restores at **90%**, and shrink ballast at **95%** so emergency checkpoints/`DROP`s always succeed.
- **Acceptance Criteria:** Tenant A filling its quota flips read-only cleanly while Tenant B continues writing normally.

---

## Part 4: P1 — High Availability, Failover & Security Risks

### RISK-18: Split-Brain & Epoch Fencing
- **Severity:** **P1**
- **Technical Explanation:** Updating a Gateway route does not stop an isolated old Cell from accepting in-flight writes or uploading stale WAL.
- **Proposed Solution:** HA Control Plane issues atomic CAS `epoch` (`WHERE epoch = $old`) and **10-second Write Leases** renewed every 3s. Missing lease renewal forces `pg-cell-agent` to fence local writes within 500ms. Both **WAL Sink** and **R2** (`If-Match` manifest + `epoch_{n}` prefixes) reject stale epochs at the storage write boundary.
- **Acceptance Criteria:** Partitioned `Epoch 1` Cell fails to commit writes past lease expiry and receives `412 PreconditionFailed` on R2.

### RISK-19 & RISK-20: Cross-Cell Failover & Live Migration
- **Severity:** **P1**
- **Technical Explanation:** Transient latency spikes can trigger false-positive failovers; live migration must avoid dual writable primaries.
- **Proposed Solution:** Failover requires **3 consecutive 500ms probe failures** (1.5s hysteresis) + Control Plane distributed lock. Live migration streams physical WAL from source Cell to target standby Cell via `6PN`, pauses Gateway writes (<100ms) when lag `< 64 KB`, advances `epoch`, runs `pg_promote()`, and flips routing.
- **Acceptance Criteria:** Zero dual-primary windows during 20 live migrations and 20 simulated host kills.

### RISK-21 through RISK-24: OS, PostgreSQL, Gateway & Tenant Data Security
- **Severity:** **P1**
- **Technical Explanation:** Multi-tenant SaaS databases face privilege escalation, protocol DoS, TLS spoofing, and orphan backup leakage.
- **Proposed Solution:**
  - **OS (RISK-21):** Non-root per-tenant UID, `0700` dirs, `hidepid=2`, `cgroups v2`, Linux `seccomp-bpf` + dropped capabilities, agent input validation.
  - **Postgres (RISK-22):** No superuser, `supautils`, TLS + `SCRAM-SHA-256` per-tenant roles, secrets kept out of `/proc/cmdline` (`PGPASSFILE`/env isolation, wiped or pipe-passed).
  - **Gateway (RISK-23):** Wildcard TLS 1.2/1.3 via DNS-01 ACME (`handlers = []` Raw TCP), 8 KB startup limit, 64 MB packet cap, per-IP rate limit, SCRAM failure exponential backoff, 5s handshake timeout, redacting logs, cryptographic binding of SNI + auth user.
  - **Data (RISK-24):** Per-tenant encrypted R2 DEKs, R2 prefix IAM scoping, soft-delete grace period + hard cryptographic erasure (`DELETE` keys + crypto-shred DEK) for tenant deletion.
- **Acceptance Criteria:** Automated security regression suite verifying cross-tenant isolation, malformed packet resilience, and complete key erasure on deletion.

---

## Part 5: P1 — Billing & Request Metering Risks

### RISK-25, RISK-26, RISK-27 & RISK-28: RU Accuracy, Accounting & Usage Ledger Reliability
- **Severity:** **P1**
- **Technical Explanation:** Counting `'Q'` packets misses multi-statement pipelining; `cgroups` `cpu.stat` mixes background `autovacuum` CPU into user queries; Gateway crashes or Queue retries can lose or double-bill events.
- **Proposed Solution:**
  - **Exact Wire Metering (RISK-25):** Count outgoing `CommandComplete` (`'C'`) + `ErrorResponse` (`'E'`) + `CopyData` bytes + backend execution duration (`Query/Execute -> ReadyForQuery`). Aborted/cancelled queries charge accurately for executed work without duplicating client retry attempts at the Gateway layer.
  - **CPU Attribution (RISK-26):** Compute query RUs from **statement count + wire bytes (32 KB/RU) + backend query duration (5 ms/RU)**; reconcile periodically against `pg_stat_statements` (`total_exec_time`, `shared_blks_read`) rather than misattributing background autovacuum cgroup CPU to innocent queries.
  - **Pricing Model (RISK-27):** Benchmark infra cost per 1M RUs in Stage 4/5 before publishing pricing; enforce per-query max `statement_timeout` & concurrency caps so heavy scans cannot become loss-making.
  - **Idempotent Ledger (RISK-28):** Gateways flush 15s batches to a local crash-safe `bbolt` WAL first, attach deterministic `idempotency_key = sha256(gateway_id + tenant_id + window_start)`, push via Cloudflare Queues, and Control Plane inserts via `ON CONFLICT (idempotency_key) DO NOTHING` before HTTP `ack`.
- **Acceptance Criteria:** 0% lost or duplicated RU events across simulated Gateway `kill -9` and Queue retry injections.

---

## Part 6: P2 — Fly.io, Control Plane, Performance & Operations Risks

### RISK-29, RISK-30 & RISK-31: Fly.io Constraints, 6PN Network & Cell Capacity
- **Severity:** **P2**
- **Solution:** Respect Fly API rate limits (`1/s` base mutations) by keeping all tenant wake/sleep local to Cells; deploy Gateways + WAL Sinks across unique zones; route directly via `<machine_id>.vm.<app>.internal` over `6PN` with exponential backoff and bounded send buffers (`backpressure` dropping stalled connections cleanly); enforce strict Cell capacity limits (max 80–100 active PG processes, max 75% `ext4` disk, max 500 warm sleeping DBs per Cell) in the Control Plane bin-packing scheduler.

### RISK-32, RISK-33 & RISK-34: Control Plane Reliability, Provisioning & DX
- **Severity:** **P2**
- **Solution:** Run Control Plane as 3-node stateless API behind Fly Load Balancer backed by a 3-node HA Postgres metadata cluster; use idempotency keys (`Idempotency-Key` header) on all `POST /databases` calls with transactional outbox + `control-reconcile-queue` rollback for interrupted provisions; expose standard TLS Postgres connection strings, pooled/direct ports, backup/PITR endpoints, usage metrics, and actionable error codes (`57P03` / clear wake-up status) for sleeping or quota-blocked databases.

### RISK-35, RISK-36, RISK-37 & RISK-38: Gateway, Wake-Up, Storage & Large Tenant Scaling
- **Severity:** **P2**
- **Solution:** Benchmark `pgproto3` + TLS memory per goroutine (~4–8 KB/conn) and bound wake-up hold queues (e.g., max 200 held sockets per waking tenant + `singleflight`) to prevent wake-up storms; benchmark `ext4` IOPS/`fsync` latency under multi-tenant load; automatically detect "Large/Hot Tenants" (>5 GB disk or sustained >50% of 1 vCPU) and promote them via live physical replication onto Dedicated Fly Compute Cells so small tenants stay isolated.

### RISK-39, RISK-40 & RISK-41: Monitoring, Alerting & Disaster Recovery
- **Severity:** **P2**
- **Solution:**
  - **Metrics (Prometheus/OpenMetrics):** PG process health/crashes, per-tenant CPU/RSS/disk, WAL generation & archive lag, backup manifest verification timestamps, connection/active query counts, `age(datfrozenxid)`, Gateway p99 & wake-up p99, Queue backlog, and RU reconciliation drift.
  - **Alerts:** Cell disk >80%/90%, memory pressure, XID age >120M, WAL archive lag >30s, WAL Sink quorum degradation (<3 nodes), R2 upload failures, and Control Plane DB unavailability.
  - **Disaster Recovery Runbooks & Drills:** Automated chaos playbooks covering total Cell loss (1.5s auto-failover via WAL Sink + R2), regional Fly outage (cross-region R2 restore), temporary R2 outage (local disk + WAL Sink buffering until R2 recovers), and accidental tenant deletion (soft-delete grace retention + PITR restore).
