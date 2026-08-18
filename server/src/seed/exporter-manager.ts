// Builds ExporterManager.java: a complete 1000+ line class with three flow
// regions pinned to exact line offsets:
//   validateMode(): 100-140
//   create():       640-690
//   persist():      810-840
// The gaps are filled with deterministic, plausible maintenance methods.

const BASE = 'src/main/java/com/acme/exporter/manager'

export const EXPORTER_MANAGER_PATH = `${BASE}/ExporterManager.java`

const HEADER = `package com.acme.exporter.manager;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.acme.exporter.async.ExporterCommandPublisher;
import com.acme.exporter.config.SourceDescriptor;
import com.acme.exporter.config.SourceDirectory;
import com.acme.exporter.metrics.ExporterMetrics;
import com.acme.exporter.store.KafkaExporterStore;
import com.acme.exporter.web.dto.CreateExporterRequest;

/**
 * Domain manager for exporter lifecycle operations.
 *
 * <p>This is the single owner of exporter state transitions. The HTTP
 * layer delegates here; the async worker pool applies persisted commands
 * through the worker. Public entry points fail fast: duplicate creation
 * attempts raise {@link ExporterExistsException} rather than producing
 * double writes, and state errors raise
 * {@link InvalidExporterStateException}.
 *
 * <p>The class is deliberately large: keeping the whole mutation surface
 * in one place makes the execution path auditable. Read paths live in the
 * store; transport concerns live in the web layer.
 */
public class ExporterManager {

    private static final Logger log = LoggerFactory.getLogger(ExporterManager.class);

    private final KafkaExporterStore store;
    private final SourceDirectory sources;
    private final ExporterCommandPublisher publisher;
    private final ExporterMetrics metrics;
    private final Map<String, ExporterCommand> cache = new ConcurrentHashMap<>();
    private final Map<String, Long> tombstones = new ConcurrentHashMap<>();

    public ExporterManager(
            KafkaExporterStore store,
            SourceDirectory sources,
            ExporterCommandPublisher publisher,
            ExporterMetrics metrics) {
        this.store = Objects.requireNonNull(store, "store");
        this.sources = Objects.requireNonNull(sources, "sources");
        this.publisher = Objects.requireNonNull(publisher, "publisher");
        this.metrics = Objects.requireNonNull(metrics, "metrics");
    }

    /**
     * Read-through lookup. Returns null when the exporter is unknown.
     */
    public ExporterCommand get(String exporterId) {
        ExporterCommand cached = cache.get(exporterId);
        if (cached != null) {
            return cached;
        }
        ExporterCommand fromStore = store.get(exporterId);
        if (fromStore != null) {
            cache.put(exporterId, fromStore);
        }
        return fromStore;
    }

    /**
     * Whether an exporter id exists, live or tombstoned.
     */
    public boolean exists(String exporterId) {
        return get(exporterId) != null || tombstones.containsKey(exporterId);
    }

    /**
     * List exporters, optionally filtered by mode.
     */
    public List<ExporterCommand> list(String mode) {
        List<ExporterCommand> all = store.list();
        if (mode == null || mode.isBlank()) {
            return all;
        }
        return all.stream()
                .filter(c -> mode.equalsIgnoreCase(c.getMode()))
                .toList();
    }

    /**
     * Whether the id carries a permanent deletion tombstone.
     */
    private boolean hasTombstone(String exporterId) {
        return tombstones.containsKey(exporterId);
    }
`

// Exactly 41 lines: lines 100-140.
const VALIDATE_MODE = `    /**
     * Validate the requested export mode against the exporter's source.
     *
     * <p>A request is rejected when the mode is unknown, when the source
     * topic cannot serve the requested mode, or when a replay request
     * lacks a resolvable offset anchor.
     *
     * <p>Rejections are domain errors and map to HTTP 422 via the mapper.
     */
    void validateMode(CreateExporterRequest request) {
        String rawMode = request.getMode();
        ExporterMode mode;
        try {
            mode = ExporterMode.fromString(rawMode);
        } catch (IllegalArgumentException e) {
            throw new InvalidExporterStateException(e.getMessage());
        }
        if (mode == ExporterMode.REPLAY && request.getPartitionCount() == null) {
            throw new InvalidExporterStateException(
                    "replay mode requires an explicit partitionCount anchor");
        }
        SourceDescriptor source = sources.describe(request.getSourceTopic());
        if (source == null) {
            throw new InvalidExporterStateException(
                    "source topic '" + request.getSourceTopic() + "' is not registered");
        }
        if (!source.supports(mode)) {
            throw new InvalidExporterStateException(
                    "source '" + source.getName() + "' does not support mode " + mode);
        }
        if (mode == ExporterMode.MIRROR && source.getPartitionCount() != source.getAssignedCount()) {
            throw new InvalidExporterStateException(
                    "source is mid-rebalance; retry after assignment settles");
        }
        if (modeConflictsWithLiveExporters(source, mode)) {
            throw new InvalidExporterStateException(
                    "a live " + mode + " exporter already covers this source");
        }
        metrics.recordModeValidation(source.getName(), mode);
        log.debug("mode {} validated for source {}", mode, source.getName());
    }`

// Exactly 51 lines: lines 640-690.
const CREATE = `    /**
     * Create a new exporter from a validated request.
     *
     * <p>Order of operations matters: mode validation first (cheap, local),
     * then the existence check (single cache read), then build, persist,
     * and finally the async handoff. The persist step is the last local
     * step before the worker pool takes over.
     */
    public ExporterCommand create(CreateExporterRequest request) {
        validateMode(request);
        String exporterId = request.getExporterId();
        if (exists(exporterId)) {
            throw new ExporterExistsException(exporterId);
        }
        if (hasTombstone(exporterId)) {
            throw new ExporterExistsException(exporterId);
        }

        ExporterCommand command = new ExporterCommand();
        command.setExporterId(exporterId);
        command.setSourceTopic(request.getSourceTopic());
        command.setMode(request.getMode());
        command.setPartitionCount(request.getPartitionCount());
        command.setCreatedAt(Instant.now());
        command.setMetadata(copyMetadata(request.getMetadata()));
        command.setRequestedBy(request.getMetadata().get("requestedBy"));

        if (command.getPartitionCount() == null) {
            command.setPartitionCount(
                    sources.describe(request.getSourceTopic()).getPartitionCount());
        }

        assignFingerprint(command);
        checkQuota(command);

        if (command.getFingerprint() == null) {
            throw new IllegalStateException("fingerprint assignment failed for " + exporterId);
        }

        persist(command);

        cache.putPending(command);

        publisher.publish(command);

        metrics.recordCreate(command.getMode());
        log.info("created exporter {} (source={}, mode={}, partitions={})",
                exporterId, request.getSourceTopic(), command.getMode(), command.getPartitionCount());

        return command;
    }`

// Exactly 31 lines: lines 810-840.
const PERSIST = `    /**
     * Persist a fully built command to the store.
     *
     * <p>Delegates to {@link KafkaExporterStore#put}, which owns
     * partitioning, acknowledgement waits, and cache rollback. The
     * command is immutable at this point; failures surface as
     * IllegalStateException to the caller and map to HTTP 500.
     */
    private void persist(ExporterCommand command) {
        Objects.requireNonNull(command, "command");
        Objects.requireNonNull(command.getFingerprint(),
                "fingerprint must be assigned before persist");
        if (command.getExporterId() == null || command.getExporterId().isBlank()) {
            throw new IllegalStateException("cannot persist a command without an exporterId");
        }

        log.debug("persisting command for {} (fingerprint={})",
                command.getExporterId(), command.getFingerprint());
        long started = metrics.nowNanos();
        try {
            store.put(command);
        } catch (IllegalStateException e) {
            metrics.recordPersistFailure(command.getMode());
            log.warn("persist failed for {}: {}", command.getExporterId(), e.getMessage());
            throw e;
        } finally {
            metrics.recordPersistLatency(command.getMode(), started);
        }
        store.invalidate(command.getExporterId());
        log.debug("persisted command for {} (mode={})", command.getExporterId(), command.getMode());
    }`

// Real helper methods placed after persist (inside the trailing filler gap).
const TAIL_HELPERS = `
    /**
     * Whether a live exporter already uses a conflicting mode on this
     * source.
     */
    private boolean modeConflictsWithLiveExporters(SourceDescriptor source, ExporterMode mode) {
        for (ExporterCommand live : list(null)) {
            if (!source.getName().equals(live.getSourceTopic())) {
                continue;
            }
            if (!"ACTIVE".equals(live.getState())) {
                continue;
            }
            ExporterMode liveMode;
            try {
                liveMode = ExporterMode.fromString(live.getMode());
            } catch (IllegalArgumentException e) {
                continue;
            }
            if (liveMode == mode && !liveMode.coexistsWith(mode)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Copy request metadata defensively.
     */
    private Map<String, String> copyMetadata(Map<String, String> metadata) {
        return metadata == null ? Map.of() : Map.copyOf(metadata);
    }

    /**
     * Assign a content fingerprint used for idempotent re-delivery.
     */
    private void assignFingerprint(ExporterCommand command) {
        int hash = command.getExporterId().hashCode()
                ^ command.getSourceTopic().hashCode()
                ^ command.getMode().hashCode();
        command.setFingerprint(Integer.toHexString(hash));
    }

    /**
     * Reject exporters that would exceed the per-source quota.
     */
    private void checkQuota(ExporterCommand command) {
        int liveCount = 0;
        for (ExporterCommand live : list(null)) {
            if (command.getSourceTopic().equals(live.getSourceTopic()) && "ACTIVE".equals(live.getState())) {
                liveCount++;
            }
        }
        if (liveCount >= 8) {
            throw new IllegalStateException("per-source exporter quota exceeded for " + command.getSourceTopic());
        }
    }
`

interface FillerBlock {
  (index: number, linesNeeded: number): string[]
}

const VARIANTS = ['opsTrace', 'opsDetail', 'opsSnapshot', 'opsAudit']

function makeFillerBlock(): FillerBlock {
  return (index, linesNeeded) => {
    const name = `${VARIANTS[index % VARIANTS.length]}_${index}`
    if (linesNeeded < 4 || linesNeeded > 59) throw new Error(`filler size out of range: ${linesNeeded}`)
    if (linesNeeded < 13) {
      // Compact variant: no leading blank line.
      const out: string[] = [`    /** ${name} - state snapshot for partition diagnostics (maintenance surface). */`]
      out.push(`    private String ${name}(String exporterId, int partition, long offset) {`)
      const body = linesNeeded - 3 // lines between signature and close
      if (body < 1) throw new Error(`compact filler body too small: ${body}`)
      if (body === 1) {
        out.push(
          `        return "${name}:" + (exporterId == null ? "unset" : exporterId) + "|" + partition + "|" + offset;`,
        )
      } else {
        out.push(`        StringBuilder sb = new StringBuilder("${name}");`)
        for (let k = 1; k <= body - 2; k++) {
          out.push(`        sb.append(", ${name}#s${k}=" + (partition * ${k} + offset));`)
        }
        out.push('        return sb.toString();')
      }
      out.push('    }')
      if (out.length !== linesNeeded) throw new Error(`compact filler length ${out.length} != ${linesNeeded}`)
      return out
    }
    const fixed = [
      '',
      '    /**',
      `     * ${name} - compact state snapshot for partition diagnostics.`,
      '     *',
      '     * <p>Maintenance surface: retained because exporter state inspection',
      '     * is part of the standard operational runbook. Not public API.',
      '     */',
      `    private String ${name}(String exporterId, int partition, long offset) {`,
      `        StringBuilder sb = new StringBuilder("${name}");`,
      '        sb.append(exporterId == null ? "unset" : exporterId);',
    ]
    const tail = ['        return sb.toString();', '    }']
    const padNeeded = linesNeeded - fixed.length - tail.length
    if (padNeeded < 1) throw new Error(`filler block too small (${linesNeeded} lines)`)
    const pad: string[] = []
    for (let k = 1; k <= padNeeded; k++) {
      pad.push(`        sb.append(", ${name}#step${k}: partition=" + partition + ", offset=" + offset);`)
    }
    return [...fixed, ...pad, ...tail]
  }
}

/**
 * Append filler methods until `lines.length === target`. Returns the next
 * filler index. Each filler method is a self-contained private helper of
 * 13-59 lines, so the total is always exact.
 */
function padTo(lines: string[], target: number, startIndex: number): number {
  const filler = makeFillerBlock()
  let i = startIndex
  while (lines.length < target) {
    const remaining = target - lines.length
    const size = remaining < 60 ? remaining : 24 + ((i * 13) % 12)
    if (size < 4) throw new Error(`cannot pad: remaining ${size} < 4`)
    lines.push(...filler(i, size))
    i++
  }
  if (lines.length !== target) throw new Error(`pad overshoot: ${lines.length} != ${target}`)
  return i
}

function countLines(block: string): number {
  return block.split('\n').length
}

// Assertion helper (function boundary resets TS control-flow narrowing on length).
function expectLen(body: string[], expected: number, what: string): void {
  if (body.length !== expected) throw new Error(`${what} misplaced: ends at ${body.length}, expected ${expected}`)
}

export function buildExporterManager(): string {
  const headerLines = HEADER.split('\n')
  if (countLines(VALIDATE_MODE) !== 41) throw new Error(`validateMode must be 41 lines, is ${countLines(VALIDATE_MODE)}`)
  if (countLines(CREATE) !== 51) throw new Error(`create must be 51 lines, is ${countLines(CREATE)}`)
  if (countLines(PERSIST) !== 31) throw new Error(`persist must be 31 lines, is ${countLines(PERSIST)}`)

  // HEADER must end before line 100 (validateMode javadoc starts at 100).
  // HEADER ends with a trailing newline -> split gives a final '' element.
  const body: string[] = headerLines
  const headerLen = body.length - 1 // exclude trailing ''
  if (headerLen < 80) throw new Error(`header too short: ${headerLen}`)
  if (headerLen > 99) throw new Error(`header too long: ${headerLen}`)
  body.pop() // drop trailing ''

  let nextIndex = padTo(body, 99, 0)

  body.push(...VALIDATE_MODE.split('\n')) // 100-140
  expectLen(body, 140, 'validateMode')

  nextIndex = padTo(body, 639, nextIndex)
  body.push(...CREATE.split('\n')) // 640-690
  expectLen(body, 690, 'create')

  nextIndex = padTo(body, 809, nextIndex)
  body.push(...PERSIST.split('\n')) // 810-840
  expectLen(body, 840, 'persist')

  body.push(...TAIL_HELPERS.split('\n')) // 841..~915
  nextIndex = padTo(body, 1058, nextIndex)
  body.push('}')
  expectLen(body, 1059, 'final')

  return body.join('\n')
}
