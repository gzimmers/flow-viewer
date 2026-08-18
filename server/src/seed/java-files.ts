// Seed source files for the acme/exporter-service demo repository.
// All files are complete, realistic Java sources (not snippets).

export interface SeedFile {
  path: string
  language: string
  content: string
}

const BASE = 'src/main/java/com/acme'

const EXPORTER_RESOURCE = `package com.acme.exporter.web;

import java.util.List;

import com.acme.exporter.manager.ExporterCommand;
import com.acme.exporter.manager.ExporterManager;
import com.acme.exporter.web.dto.CreateExporterRequest;
import com.acme.exporter.web.dto.ExporterResponse;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

/**
 * HTTP entry points for exporter lifecycle operations.
 *
 * <p>This resource is intentionally thin: request binding, delegation to
 * {@link ExporterManager}, and response shaping. Domain rules (mode
 * validation, existence checks, state transitions) live in the manager;
 * exception-to-status mapping lives in {@link ExporterExceptionMapper}.
 */
@Path("/exporters")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class ExporterResource {

    private final ExporterManager manager;

    public ExporterResource(ExporterManager manager) {
        this.manager = manager;
    }

    /**
     * Create a new exporter.
     *
     * <p>The HTTP request is synchronous and fast: it validates the request,
     * checks existence, persists the command, and enqueues async work. Topic
     * provisioning and the initial fetch happen on the consumer pool after
     * the 201 has been returned (see the async boundary in
     * {@code ExporterCommandPublisher}).
     */
    @POST
    public Response createExporter(CreateExporterRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        ExporterCommand command = manager.create(request);
        return buildCreatedResponse(command);
    }

    /**
     * Shape the 201 response. Exporters start in PENDING state; the worker
     * pool transitions them to ACTIVE once provisioning completes.
     */
    private Response buildCreatedResponse(ExporterCommand command) {
        ExporterResponse body = new ExporterResponse(
                command.getExporterId(),
                command.getMode(),
                "PENDING",
                command.getCreatedAt().toString());
        return Response.status(Response.Status.CREATED).entity(body).build();
    }

    /**
     * List all exporters, optionally filtered by mode.
     */
    @GET
    public List<ExporterResponse> listExporters(@QueryParam("mode") String mode) {
        return manager.list(mode).stream()
                .map(ExporterResponse::fromCommand)
                .toList();
    }

    /**
     * Fetch a single exporter by id.
     */
    @GET
    @Path("/{id}")
    public ExporterResponse getExporter(@PathParam("id") String id) {
        return ExporterResponse.fromCommand(manager.get(id));
    }
}
`

const CREATE_EXPORTER_REQUEST = `package com.acme.exporter.web.dto;

import java.util.HashMap;
import java.util.Map;

/**
 * Request body for {@code POST /exporters}.
 *
 * <p>Binding is lenient about unknown fields (forward compatibility) but
 * strict about the fields below. {@code mode} is validated against
 * {@link com.acme.exporter.manager.ExporterMode} during manager processing,
 * not here, so the web layer does not own domain rules.
 */
public class CreateExporterRequest {

    /** Stable identifier chosen by the caller. Must be unique per service. */
    private String exporterId;

    /** Source topic the exporter reads from. */
    private String sourceTopic;

    /** Export mode: {@code mirror}, {@code replay} or {@code tail}. */
    private String mode;

    /** Optional explicit partition count override. */
    private Integer partitionCount;

    /** Free-form metadata carried through to the exporter command. */
    private Map<String, String> metadata;

    public String getExporterId() {
        return exporterId;
    }

    public void setExporterId(String exporterId) {
        this.exporterId = exporterId;
    }

    public String getSourceTopic() {
        return sourceTopic;
    }

    public void setSourceTopic(String sourceTopic) {
        this.sourceTopic = sourceTopic;
    }

    public String getMode() {
        return mode;
    }

    public void setMode(String mode) {
        this.mode = mode;
    }

    public Integer getPartitionCount() {
        return partitionCount;
    }

    public void setPartitionCount(Integer partitionCount) {
        this.partitionCount = partitionCount;
    }

    public Map<String, String> getMetadata() {
        return metadata == null ? new HashMap<>() : metadata;
    }

    public void setMetadata(Map<String, String> metadata) {
        this.metadata = metadata;
    }
}
`

const EXPORTER_RESPONSE = `package com.acme.exporter.web.dto;

import com.acme.exporter.manager.ExporterCommand;

/**
 * Read model returned by the exporter endpoints.
 */
public class ExporterResponse {

    public final String exporterId;
    public final String mode;
    public final String state;
    public final String createdAt;

    public ExporterResponse(String exporterId, String mode, String state, String createdAt) {
        this.exporterId = exporterId;
        this.mode = mode;
        this.state = state;
        this.createdAt = createdAt;
    }

    public static ExporterResponse fromCommand(ExporterCommand command) {
        return new ExporterResponse(
                command.getExporterId(),
                command.getMode(),
                command.getState(),
                command.getCreatedAt().toString());
    }

    public String getExporterId() {
        return exporterId;
    }

    public String getMode() {
        return mode;
    }

    public String getState() {
        return state;
    }

    public String getCreatedAt() {
        return createdAt;
    }
}
`

const EXPORTER_EXCEPTION_MAPPER = `package com.acme.exporter.web;

import com.acme.exporter.manager.ExporterExistsException;
import com.acme.exporter.manager.InvalidExporterStateException;

import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;

/**
 * Maps exporter domain exceptions to stable HTTP exit statuses.
 *
 * <p>Statuses are part of the public contract:
 *
 * <ul>
 *   <li>400 Invalid Request - malformed or rejected request payload</li>
 *   <li>409 Exporter Exists - id collision with a live or tombstoned exporter</li>
 *   <li>422 Invalid State - well-formed request, unacceptable state</li>
 *   <li>500 Internal Error - unexpected failure; an incident id is attached</li>
 * </ul>
 */
@Provider
public class ExporterExceptionMapper {

    /**
     * Malformed request: missing fields, unknown enum values, or an
     * unparsable body. The caller can retry with a corrected payload.
     */
    public Response mapBadRequest(IllegalArgumentException e) {
        return Response.status(Response.Status.BAD_REQUEST)
                .type(MediaType.APPLICATION_JSON)
                .entity(new ExporterResource.ErrorBody("invalid_request", e.getMessage()))
                .build();
    }

    /**
     * The requested exporter id already exists. Exporter ids are never
     * reused, even after deletion (tombstones are permanent).
     */
    public Response mapExists(ExporterExistsException e) {
        return Response.status(409)
                .type(MediaType.APPLICATION_JSON)
                .entity(new ExporterResource.ErrorBody("exporter_exists",
                        "exporter '" + e.getExporterId() + "' already exists"))
                .build();
    }

    /**
     * The request is well-formed, but the exporter (or its source) is not
     * in a state that can perform the requested operation.
     */
    public Response mapInvalidState(InvalidExporterStateException e) {
        return Response.status(422)
                .type(MediaType.APPLICATION_JSON)
                .entity(new ExporterResource.ErrorBody("invalid_state", e.getMessage()))
                .build();
    }

    /**
     * Catch-all for unexpected failures. Attaches a short incident id so
     * operators can correlate logs without exposing internals.
     */
    public Response mapInternal(Exception e) {
        String incident = "inc-" + Long.toHexString(System.nanoTime());
        return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                .type(MediaType.APPLICATION_JSON)
                .entity(new ExporterResource.ErrorBody("internal_error",
                        "unexpected failure; incident " + incident))
                .build();
    }
}
`

const EXPORTER_MODE = `package com.acme.exporter.manager;

import java.util.Locale;

/**
 * Export modes supported by the service.
 *
 * <ul>
 *   <li>{@code MIRROR} - live, partition-aligned copy of the source topic</li>
 *   <li>{@code REPLAY} - bounded historical re-read from an explicit offset</li>
 *   <li>{@code TAIL} - unbounded follow of new records, no history</li>
 * </ul>
 */
public enum ExporterMode {

    MIRROR,
    REPLAY,
    TAIL;

    /**
     * Parse a mode string. Case-insensitive.
     *
     * @throws IllegalArgumentException when the value is not a known mode
     */
    public static ExporterMode fromString(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("mode is required");
        }
        try {
            return valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException(
                    "unknown mode '" + raw + "' (expected mirror, replay or tail)");
        }
    }

    /**
     * Whether two modes can coexist on the same source topic.
     */
    public boolean coexistsWith(ExporterMode other) {
        return this != REPLAY || other != REPLAY;
    }
}
`

const INVALID_EXPORTER_STATE_EXCEPTION = `package com.acme.exporter.manager;

/**
 * Thrown when a request is well-formed but the exporter (or its source)
 * is not in a state that can perform the operation.
 *
 * <p>Maps to HTTP 422 via {@code ExporterExceptionMapper}.
 */
public class InvalidExporterStateException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public InvalidExporterStateException(String message) {
        super(message);
    }

    public InvalidExporterStateException(String message, Throwable cause) {
        super(message, cause);
    }
}
`

const EXPORTER_EXISTS_EXCEPTION = `package com.acme.exporter.manager;

/**
 * Thrown when the requested exporter id already exists, live or
 * tombstoned. Exporter ids are never reused.
 *
 * <p>Maps to HTTP 409 via {@code ExporterExceptionMapper}.
 */
public class ExporterExistsException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final String exporterId;

    public ExporterExistsException(String exporterId) {
        super("exporter '" + exporterId + "' already exists");
        this.exporterId = exporterId;
    }

    public String getExporterId() {
        return exporterId;
    }
}
`

const EXPORTER_COMMAND = `package com.acme.exporter.manager;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * Command describing a new exporter.
 *
 * <p>Commands are the unit of the async pipeline: the store persists them,
 * the publisher enqueues them, and the worker applies them. After
 * construction a command is treated as immutable.
 */
public class ExporterCommand {

    private String exporterId;
    private String sourceTopic;
    private String mode;
    private String state;
    private Integer partitionCount;
    private Instant createdAt;
    private String fingerprint;
    private String requestedBy;
    private Map<String, String> metadata;

    public ExporterCommand() {
        this.state = "PENDING";
        this.metadata = new HashMap<>();
    }

    public String getExporterId() {
        return exporterId;
    }

    public void setExporterId(String exporterId) {
        this.exporterId = exporterId;
    }

    public String getSourceTopic() {
        return sourceTopic;
    }

    public void setSourceTopic(String sourceTopic) {
        this.sourceTopic = sourceTopic;
    }

    public String getMode() {
        return mode;
    }

    public void setMode(String mode) {
        this.mode = mode;
    }

    public String getState() {
        return state;
    }

    public void setState(String state) {
        this.state = state;
    }

    public Integer getPartitionCount() {
        return partitionCount;
    }

    public void setPartitionCount(Integer partitionCount) {
        this.partitionCount = partitionCount;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public String getFingerprint() {
        return fingerprint;
    }

    public void setFingerprint(String fingerprint) {
        this.fingerprint = fingerprint;
    }

    public String getRequestedBy() {
        return requestedBy;
    }

    public void setRequestedBy(String requestedBy) {
        this.requestedBy = requestedBy;
    }

    public Map<String, String> getMetadata() {
        return metadata;
    }

    public void setMetadata(Map<String, String> metadata) {
        this.metadata = metadata == null ? new HashMap<>() : metadata;
    }
}
`

const KAFKA_EXPORTER_STORE = `package com.acme.exporter.store;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.Producer;
import org.apache.kafka.clients.producer.ProducerRecord;

import com.acme.exporter.config.StoreConfig;
import com.acme.exporter.manager.ExporterCommand;
import com.acme.exporter.manager.ExporterExistsException;
import com.acme.exporter.metrics.ExporterMetrics;

/**
 * Kafka-backed store for exporter commands.
 *
 * <p>The command topic is the source of truth for "which exporters exist".
 * The in-memory cache is a read-through optimization only; every mutation
 * goes through the broker so that all service instances agree.
 */
public class KafkaExporterStore implements AutoCloseable {

    private static final char PARTITION_SALT = '\\u0001';

    private final Producer<byte[], byte[]> producer;
    private final StoreConfig config;
    private final CommandCodec codec;
    private final ExporterMetrics metrics;
    private final Map<String, ExporterCommand> cache = new ConcurrentHashMap<>();

    public KafkaExporterStore(Producer<byte[], byte[]> producer, StoreConfig config,
            CommandCodec codec, ExporterMetrics metrics) {
        this.producer = Objects.requireNonNull(producer);
        this.config = Objects.requireNonNull(config);
        this.codec = Objects.requireNonNull(codec);
        this.metrics = Objects.requireNonNull(metrics);
    }

    /**
     * Read-through lookup of a single exporter command.
     *
     * @return the command, or null when the exporter is unknown
     */
    public ExporterCommand get(String exporterId) {
        ExporterCommand cached = cache.get(exporterId);
        if (cached != null) {
            return cached;
        }
        byte[] payload = readFromTopic(exporterId);
        if (payload == null) {
            return null;
        }
        ExporterCommand command = codec.decode(payload);
        cache.put(exporterId, command);
        return command;
    }

    /**
     * List all exporter commands currently known to the store.
     */
    public List<ExporterCommand> list() {
        List<ExporterCommand> out = new ArrayList<>(cache.values());
        for (String key : knownKeys()) {
            ExporterCommand command = get(key);
            if (command != null) {
                out.add(command);
            }
        }
        return out;
    }

    /**
     * Whether the given exporter id exists in the store or cache.
     */
    public boolean contains(String exporterId) {
        return cache.containsKey(exporterId) || readFromTopic(exporterId) != null;
    }

    /**
     * Persist a new exporter command to the command topic.
     *
     * <p>The write is exactly-once from the caller's perspective: the store
     * serializes the command, assigns the partition from the exporter id,
     * and waits for broker acknowledgement before returning. On failure the
     * in-memory cache is rolled back so the next retry sees a clean state.
     */
    public void put(ExporterCommand command) {
        Objects.requireNonNull(command, "command");
        Objects.requireNonNull(command.getExporterId(), "command.exporterId");

        ExporterCommand existing = cache.get(command.getExporterId());
        if (existing != null) {
            throw new ExporterExistsException(command.getExporterId());
        }

        int partition = partitionFor(command.getExporterId());
        byte[] payload = codec.encode(command);

        ProducerRecord<byte[], byte[]> record = new ProducerRecord<>(
                config.getCommandTopic(), partition,
                command.getExporterId().getBytes(StandardCharsets.UTF_8), payload);

        try {
            producer.send(record).get(config.getAckTimeoutMs(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while persisting exporter command", e);
        } catch (ExecutionException e) {
            rollbackCache(command);
            throw new IllegalStateException(
                    "failed to persist exporter command to " + config.getCommandTopic(), e);
        } catch (TimeoutException e) {
            rollbackCache(command);
            throw new IllegalStateException("timed out persisting exporter command", e);
        }

        cache.put(command.getExporterId(), command);
        metrics.recordPut(command.getMode(), partition);
    }

    /**
     * Invalidate the read-through cache entry for an exporter.
     */
    public void invalidate(String exporterId) {
        cache.remove(exporterId);
    }

    /**
     * Warm the read-through cache for startup. Non-fatal: a cache miss is
     * only a latency penalty, never a correctness problem.
     */
    public void warmUp() {
        long started = System.nanoTime();
        int warmed = 0;
        for (String key : knownKeys()) {
            if (get(key) != null) {
                warmed++;
            }
        }
        metrics.recordCacheWarm(warmed, System.nanoTime() - started);
    }

    /**
     * Deterministic partition assignment: exporters for the same id always
     * land on the same partition, which keeps per-exporter ordering.
     */
    private int partitionFor(String exporterId) {
        int hash = exporterId.hashCode() ^ (exporterId.length() * PARTITION_SALT);
        int partitions = config.getCommandPartitions();
        return Math.floorMod(hash, partitions);
    }

    private byte[] readFromTopic(String exporterId) {
        try {
            return codec.latestFor(exporterId, config.getReadTimeoutMs());
        } catch (RuntimeException e) {
            metrics.recordReadFailure(exporterId);
            return null;
        }
    }

    private List<String> knownKeys() {
        return config.knownExporterKeys();
    }

    private void rollbackCache(ExporterCommand command) {
        cache.remove(command.getExporterId());
    }

    @Override
    public void close() {
        producer.flush();
        producer.close();
    }
}
`

const EXPORTER_COMMAND_PUBLISHER = `package com.acme.exporter.async;

import java.time.Instant;
import java.util.Objects;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.acme.exporter.manager.ExporterCommand;
import com.acme.exporter.metrics.ExporterMetrics;

/**
 * Synchronous/async boundary for exporter creation.
 *
 * <p>This class owns the handoff from the HTTP thread to the worker pool.
 * Everything above this class runs under the caller's request; everything
 * below it (consumer, worker) runs on the async pool. The queue is bounded:
 * when it is full, publish fails fast rather than blocking the HTTP thread.
 */
public class ExporterCommandPublisher {

    private static final Logger log = LoggerFactory.getLogger(ExporterCommandPublisher.class);

    private final BlockingQueue<ExporterCommandEnvelope> queue;
    private final ExporterMetrics metrics;
    private final int maxQueueDepth;

    public ExporterCommandPublisher(ExporterMetrics metrics, int maxQueueDepth) {
        this.metrics = Objects.requireNonNull(metrics);
        this.maxQueueDepth = maxQueueDepth;
        this.queue = new LinkedBlockingQueue<>(maxQueueDepth);
    }

    /**
     * Enqueue an exporter command for async processing.
     *
     * <p>This call happens on the HTTP thread. From here on, execution
     * continues on the consumer pool; the HTTP request returns 201 without
     * waiting for provisioning to complete.
     */
    public void publish(ExporterCommand command) {
        Objects.requireNonNull(command, "command");
        if (command.getExporterId() == null || command.getExporterId().isBlank()) {
            throw new IllegalStateException("cannot publish a command without an exporterId");
        }
        ExporterCommandEnvelope envelope = new ExporterCommandEnvelope(command, 1, Instant.now());
        if (!queue.offer(envelope)) {
            metrics.recordRejected(command.getMode());
            log.warn("exporter command queue full; rejecting {}", command.getExporterId());
            throw new IllegalStateException("exporter command queue is full; retry");
        }
        metrics.recordPublish(command.getMode(), queue.size());
        log.info("enqueued exporter command {} (queue depth {})",
                command.getExporterId(), queue.size());
    }

    /**
     * Current queue depth. Used by health checks and the startup report.
     */
    public int queueDepth() {
        return queue.size();
    }

    /**
     * Hand the queue to the consumer. Called once during bootstrap.
     */
    public BlockingQueue<ExporterCommandEnvelope> attachTo(ExporterCommandConsumer consumer) {
        consumer.attach(queue);
        return queue;
    }
}
`

const EXPORTER_COMMAND_ENVELOPE = `package com.acme.exporter.async;

import java.time.Instant;

import com.acme.exporter.manager.ExporterCommand;

/**
 * A queued exporter command plus retry bookkeeping.
 */
public class ExporterCommandEnvelope {

    private final ExporterCommand command;
    private final int attempt;
    private final Instant enqueuedAt;

    public ExporterCommandEnvelope(ExporterCommand command, int attempt, Instant enqueuedAt) {
        this.command = command;
        this.attempt = attempt;
        this.enqueuedAt = enqueuedAt;
    }

    public ExporterCommand getCommand() {
        return command;
    }

    public int getAttempt() {
        return attempt;
    }

    public Instant getEnqueuedAt() {
        return enqueuedAt;
    }

    public ExporterCommandEnvelope withNextAttempt() {
        return new ExporterCommandEnvelope(command, attempt + 1, Instant.now());
    }
}
`

const EXPORTER_COMMAND_CONSUMER = `package com.acme.exporter.async;

import java.util.Objects;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.acme.exporter.metrics.ExporterMetrics;
import com.acme.exporter.store.KafkaExporterStore;
import com.acme.exporter.worker.ExporterWorker;
import com.acme.exporter.worker.ExporterWorkerException;

/**
 * Consumes exporter commands on the worker pool.
 *
 * <p>This class lives on the other side of the async boundary: it is never
 * called from the HTTP thread. A single daemon thread drains the queue;
 * failures are retried a bounded number of times before being dead-lettered.
 */
public class ExporterCommandConsumer implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(ExporterCommandConsumer.class);

    private final ExporterWorker worker;
    private final KafkaExporterStore store;
    private final ExporterMetrics metrics;
    private final int maxAttempts;
    private volatile BlockingQueue<ExporterCommandEnvelope> queue;
    private volatile boolean running;
    private Thread thread;

    public ExporterCommandConsumer(ExporterWorker worker, KafkaExporterStore store,
            ExporterMetrics metrics, int maxAttempts) {
        this.worker = Objects.requireNonNull(worker);
        this.store = Objects.requireNonNull(store);
        this.metrics = Objects.requireNonNull(metrics);
        this.maxAttempts = maxAttempts;
    }

    /**
     * Start the drain loop. Called once during service bootstrap.
     */
    public void init() {
        running = true;
        thread = new Thread(this::drainLoop, "exporter-command-consumer");
        thread.setDaemon(true);
        thread.start();
        log.info("exporter command consumer started");
    }

    /**
     * Wire the publisher queue into this consumer.
     */
    public void attach(BlockingQueue<ExporterCommandEnvelope> queue) {
        this.queue = Objects.requireNonNull(queue);
    }

    /**
     * Process a single enqueued command. Invoked once per command on the
     * async pool thread.
     */
    public void onMessage(ExporterCommandEnvelope envelope) {
        ExporterCommand command = envelope.getCommand();
        log.info("processing exporter command {} (attempt {})",
                command.getExporterId(), envelope.getAttempt());
        try {
            if (!store.contains(command.getExporterId())) {
                log.warn("command for unknown exporter {}, dead-lettering", command.getExporterId());
                deadLetter(envelope, "unknown-exporter");
                return;
            }
            worker.process(command);
            metrics.recordSuccess(command.getMode());
        } catch (ExporterWorkerException e) {
            if (envelope.getAttempt() >= maxAttempts) {
                deadLetter(envelope, e.getReason());
            } else {
                requeue(envelope);
            }
        }
    }

    /**
     * The drain loop. Polls the queue with a timeout so shutdown can be
     * observed promptly.
     */
    private void drainLoop() {
        while (running) {
            try {
                ExporterCommandEnvelope envelope = queue.poll(250, TimeUnit.MILLISECONDS);
                if (envelope != null) {
                    onMessage(envelope);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        log.info("exporter command consumer stopped");
    }

    private void requeue(ExporterCommandEnvelope envelope) {
        try {
            queue.put(envelope.withNextAttempt());
            metrics.recordRetry(envelope.getCommand().getMode());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void deadLetter(ExporterCommandEnvelope envelope, String reason) {
        metrics.recordDeadLetter(envelope.getCommand().getMode(), reason);
        log.error("dead-lettering exporter command {} ({})",
                envelope.getCommand().getExporterId(), reason);
    }

    @Override
    public void close() {
        running = false;
        if (thread != null) {
            thread.interrupt();
        }
    }
}
`

const EXPORTER_WORKER = `package com.acme.exporter.worker;

import java.util.Objects;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.acme.exporter.config.TopicProvisioner;
import com.acme.exporter.manager.ExporterCommand;
import com.acme.exporter.metrics.ExporterMetrics;
import com.acme.exporter.store.KafkaExporterStore;

/**
 * Applies exporter commands: provisions the target topic, registers the
 * fetcher, and transitions the exporter to ACTIVE.
 *
 * <p>Runs on the async pool only. All methods are safe to call once per
 * command; retries re-run provisioning, which is idempotent.
 */
public class ExporterWorker {

    private static final Logger log = LoggerFactory.getLogger(ExporterWorker.class);

    private final TopicProvisioner provisioner;
    private final KafkaExporterStore store;
    private final ExporterMetrics metrics;

    public ExporterWorker(TopicProvisioner provisioner, KafkaExporterStore store, ExporterMetrics metrics) {
        this.provisioner = Objects.requireNonNull(provisioner);
        this.store = Objects.requireNonNull(store);
        this.metrics = Objects.requireNonNull(metrics);
    }

    /**
     * Apply a single exporter command end to end: provision, register, and
     * flip state. Failures raise {@link ExporterWorkerException} with a
     * short reason code that the consumer uses for retry decisions.
     */
    public void process(ExporterCommand command) {
        String exporterId = command.getExporterId();
        long started = System.nanoTime();

        TopicProvisioner.Plan plan = provisioner.plan(command);
        if (plan == null) {
            throw new ExporterWorkerException("provisioning-plan-failed",
                    "no provisioning plan for " + exporterId);
        }

        try {
            provisioner.apply(plan);
        } catch (RuntimeException e) {
            metrics.recordProvisionFailure(command.getMode());
            throw new ExporterWorkerException("provisioning-failed",
                    "topic provisioning failed for " + exporterId, e);
        }

        if (command.getPartitionCount() == null || command.getPartitionCount() <= 0) {
            throw new ExporterWorkerException("bad-partition-count",
                    "exporter " + exporterId + " has no valid partition count");
        }

        registerFetcher(exporterId, command);
        apply(command);

        metrics.recordApply(command.getMode(), System.nanoTime() - started);
        log.info("applied exporter {} (mode={}, partitions={})",
                exporterId, command.getMode(), command.getPartitionCount());
    }

    /**
     * Persist the ACTIVE state transition for an applied exporter.
     *
     * <p>The state flip is the last durable step of the async pipeline:
     * once this returns, the exporter is visible to readers as ACTIVE.
     */
    public void apply(ExporterCommand command) {
        if (!"PENDING".equals(command.getState())) {
            throw new ExporterWorkerException("bad-state",
                    "expected PENDING but found " + command.getState() + " for " + command.getExporterId());
        }
        command.setState("ACTIVE");
        store.invalidate(command.getExporterId());
        log.debug("exporter {} transitioned to ACTIVE", command.getExporterId());
    }

    private void registerFetcher(String exporterId, ExporterCommand command) {
        // The fetcher registry is per-instance; all instances register the
        // same set because the store is the shared source of truth.
        metrics.recordFetcherRegistered(command.getMode());
        log.debug("registered fetcher for {}", exporterId);
    }
}
`

const EXPORTER_WORKER_EXCEPTION = `package com.acme.exporter.worker;

/**
 * Worker-side failure with a stable reason code.
 *
 * <p>Reason codes drive retry policy in the consumer and show up in the
 * dead-letter log, so they must be stable and short.
 */
public class ExporterWorkerException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final String reason;

    public ExporterWorkerException(String reason, String message) {
        super(message);
        this.reason = reason;
    }

    public ExporterWorkerException(String reason, String message, Throwable cause) {
        super(message, cause);
        this.reason = reason;
    }

    public String getReason() {
        return reason;
    }
}
`

// ---------------------------------------------------------------------------
// Startup flow files
// ---------------------------------------------------------------------------

const EXPORTER_APPLICATION = `package com.acme.exporter;

import com.acme.exporter.bootstrap.BootstrapOptions;
import com.acme.exporter.bootstrap.ExporterBootstrap;
import com.acme.exporter.bootstrap.BootstrapException;

/**
 * Service entry point.
 *
 * <p>Deliberately tiny: argument parsing and lifecycle both live in
 * {@link ExporterBootstrap}. The JVM exit code is the startup contract
 * (0 = healthy, 1 = failed) used by the process supervisor.
 */
public final class ExporterApplication {

    private ExporterApplication() {
    }

    /**
     * Service main. Parses bootstrap options, runs the bootstrap sequence,
     * and exits with 0 on success or 1 on {@link BootstrapException}.
     */
    public static void main(String[] args) {
        BootstrapOptions options;
        try {
            options = BootstrapOptions.fromArgs(args);
        } catch (IllegalArgumentException e) {
            System.err.println("[exporter-service] bad arguments: " + e.getMessage());
            System.err.println(usage());
            System.exit(2);
            return;
        }

        ExporterBootstrap bootstrap = new ExporterBootstrap(options);
        int code;
        try {
            bootstrap.run();
            code = 0;
        } catch (BootstrapException e) {
            System.err.println("[exporter-service] startup failed: " + e.getMessage());
            e.printStackTrace(System.err);
            code = 1;
        }
        System.exit(code);
    }

    private static String usage() {
        return "usage: exporter-service [--config <path>] [--dry-run]";
    }
}
`

const BOOTSTRAP_OPTIONS = `package com.acme.exporter.bootstrap;

/**
 * Parsed startup options.
 */
public class BootstrapOptions {

    private final String configPath;
    private final boolean dryRun;

    private BootstrapOptions(String configPath, boolean dryRun) {
        this.configPath = configPath;
        this.dryRun = dryRun;
    }

    /**
     * Parse command line arguments. Unknown flags are rejected so typos
     * fail at startup instead of at first use.
     */
    public static BootstrapOptions fromArgs(String[] args) {
        String configPath = "config/exporter.properties";
        boolean dryRun = false;
        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--config":
                    if (i + 1 >= args.length) {
                        throw new IllegalArgumentException("--config requires a value");
                    }
                    configPath = args[++i];
                    break;
                case "--dry-run":
                    dryRun = true;
                    break;
                default:
                    throw new IllegalArgumentException("unknown argument: " + args[i]);
            }
        }
        return new BootstrapOptions(configPath, dryRun);
    }

    public String getConfigPath() {
        return configPath;
    }

    public boolean isDryRun() {
        return dryRun;
    }
}
`

const EXPORTER_BOOTSTRAP = `package com.acme.exporter.bootstrap;

import java.util.Objects;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.acme.exporter.async.ExporterCommandConsumer;
import com.acme.exporter.async.ExporterCommandPublisher;
import com.acme.exporter.config.KafkaClientFactory;
import com.acme.exporter.config.ServiceConfig;
import com.acme.exporter.worker.ExporterWorker;
import com.acme.exporter.store.KafkaExporterStore;

/**
 * Service bootstrap: constructs and wires the runtime object graph, then
 * brings the async pipeline online.
 *
 * <p>Startup is all-or-nothing: if any step fails, the process exits with
 * a non-zero code and the supervisor restarts. There is no degraded mode.
 */
public class ExporterBootstrap {

    private static final Logger log = LoggerFactory.getLogger(ExporterBootstrap.class);

    private final BootstrapOptions options;
    private final KafkaClientFactory kafka;
    private ExporterCommandPublisher publisher;
    private ExporterCommandConsumer consumer;
    private KafkaExporterStore store;
    private long startedAtNanos;

    public ExporterBootstrap(BootstrapOptions options) {
        this.options = Objects.requireNonNull(options);
        this.kafka = new KafkaClientFactory();
    }

    /**
     * Run the full startup sequence.
     *
     * <p>Steps: load config, create the Kafka producer, warm the store,
     * construct the async pipeline, start the consumer, and mark ready.
     * Any failure raises {@link BootstrapException} with the failed step.
     */
    public void run() {
        startedAtNanos = System.nanoTime();
        log.info("starting exporter-service (config={})", options.getConfigPath());

        ServiceConfig config;
        try {
            config = ServiceConfig.load(options.getConfigPath());
        } catch (RuntimeException e) {
            throw new BootstrapException("config", e);
        }
        log.info("step 1/5: config loaded ({} properties)", config.size());

        try {
            kafka.createProducer(config);
            log.info("step 2/5: kafka producer connected (bootstrap={})", config.getBootstrapServers());
        } catch (RuntimeException e) {
            throw new BootstrapException("kafka-producer", e);
        }

        store = new KafkaExporterStore(kafka.producer(), config.store(),
                new com.acme.exporter.store.CommandCodec(),
                com.acme.exporter.metrics.ExporterMetrics.shared());
        try {
            store.warmUp();
            log.info("step 3/5: store warmed");
        } catch (RuntimeException e) {
            throw new BootstrapException("store-warm", e);
        }

        ExporterWorker worker = new ExporterWorker(
                config.topicProvisioner(), store, com.acme.exporter.metrics.ExporterMetrics.shared());
        publisher = new ExporterCommandPublisher(
                com.acme.exporter.metrics.ExporterMetrics.shared(), config.getMaxQueueDepth());
        consumer = new ExporterCommandConsumer(
                worker, store, com.acme.exporter.metrics.ExporterMetrics.shared(), config.getMaxAttempts());

        try {
            publisher.attachTo(consumer);
            consumer.init();
            log.info("step 4/5: async pipeline online (queue depth {})", publisher.queueDepth());
        } catch (RuntimeException e) {
            throw new BootstrapException("async-pipeline", e);
        }

        markReady(config);
        log.info("step 5/5: service ready in {} ms",
                (System.nanoTime() - startedAtNanos) / 1_000_000);
    }

    /**
     * Final startup step: expose readiness. In a real deployment this
     * opens the health port; here we record it in the startup report.
     */
    private void markReady(ServiceConfig config) {
        if (options.isDryRun()) {
            log.info("dry-run: readiness check skipped");
            return;
        }
        StartupReport report = StartupReport.of(config, System.nanoTime() - startedAtNanos);
        log.info("startup report: {}", report);
    }

    /**
     * Shutdown hook target: stop the consumer, then close the store.
     */
    public void shutdown() {
        if (consumer != null) {
            consumer.close();
        }
        if (store != null) {
            store.close();
        }
        log.info("service stopped");
    }
}
`

const BOOTSTRAP_EXCEPTION = `package com.acme.exporter.bootstrap;

/**
 * Startup failure with the name of the failed step.
 *
 * <p>The step name is stable and short; it is the primary field in the
 * supervisor's failure log.
 */
public class BootstrapException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final String step;

    public BootstrapException(String step, Throwable cause) {
        super("startup failed at step '" + step + "'", cause);
        this.step = step;
    }

    public String getStep() {
        return step;
    }
}
`

const KAFKA_CLIENT_FACTORY = `package com.acme.exporter.config;

import java.util.HashMap;
import java.util.Map;

import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.Producer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.ByteArraySerializer;

/**
 * Factory for Kafka clients. Centralizes client properties so that every
 * client in the service uses the same tuned baseline.
 */
public class KafkaClientFactory {

    private Producer<byte[], byte[]> producer;

    /**
     * Build the command producer for the exporter pipeline.
     *
     * <p>acks=all and an idempotent producer are mandatory: the command
     * topic is the source of truth for exporter existence, so duplicates
     * and silent loss are both unacceptable.
     */
    public void createProducer(ServiceConfig config) {
        Map<String, Object> props = new HashMap<>();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, config.getBootstrapServers());
        props.put(ProducerConfig.ACKS_CONFIG, "all");
        props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        props.put(ProducerConfig.RETRIES_CONFIG, config.getProducerRetries());
        props.put(ProducerConfig.LINGER_MS_CONFIG, 5);
        props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, config.getDeliveryTimeoutMs());
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);

        producer = new KafkaProducer<>(props);
    }

    /**
     * The shared producer. Valid after {@link #createProducer}.
     */
    public Producer<byte[], byte[]> producer() {
        if (producer == null) {
            throw new IllegalStateException("producer not created; call createProducer first");
        }
        return producer;
    }
}
`

const SERVICE_CONFIG = `package com.acme.exporter.config;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

/**
 * Typed view over the service properties file.
 *
 * <p>Unknown keys are preserved (forward compatibility); missing required
 * keys fail at load time, which is the only acceptable place for config
 * errors to surface.
 */
public class ServiceConfig {

    private final Map<String, String> raw;

    private ServiceConfig(Map<String, String> raw) {
        this.raw = raw;
    }

    /**
     * Load and validate the properties file.
     */
    public static ServiceConfig load(String path) {
        Properties props = new Properties();
        try (InputStream in = Files.newInputStream(Path.of(path))) {
            props.load(in);
        } catch (IOException e) {
            throw new IllegalStateException("cannot read config " + path, e);
        }
        Map<String, String> raw = new HashMap<>();
        for (String name : props.stringPropertyNames()) {
            raw.put(name, props.getProperty(name));
        }
        require(raw, "kafka.bootstrap.servers");
        return new ServiceConfig(raw);
    }

    private static void require(Map<String, String> raw, String key) {
        if (!raw.containsKey(key) || raw.get(key).isBlank()) {
            throw new IllegalStateException("missing required config: " + key);
        }
    }

    public int size() {
        return raw.size();
    }

    public String getBootstrapServers() {
        return raw.get("kafka.bootstrap.servers");
    }

    public int getProducerRetries() {
        return intOrDefault("producer.retries", 5);
    }

    public int getDeliveryTimeoutMs() {
        return intOrDefault("producer.delivery.timeout.ms", 10_000);
    }

    public int getMaxQueueDepth() {
        return intOrDefault("async.queue.max.depth", 1024);
    }

    public int getMaxAttempts() {
        return intOrDefault("async.max.attempts", 4);
    }

    public StoreConfig store() {
        return new StoreConfig(
                stringOrDefault("store.command.topic", "exporter-commands"),
                intOrDefault("store.command.partitions", 12),
                intOrDefault("store.ack.timeout.ms", 5_000),
                intOrDefault("store.read.timeout.ms", 2_000));
    }

    public TopicProvisioner topicProvisioner() {
        return new TopicProvisioner(stringOrDefault("provisioner.target.prefix", "exporter-"));
    }

    private int intOrDefault(String key, int fallback) {
        String v = raw.get(key);
        if (v == null || v.isBlank()) {
            return fallback;
        }
        try {
            return Integer.parseInt(v.trim());
        } catch (NumberFormatException e) {
            throw new IllegalStateException("config " + key + " is not an integer: " + v);
        }
    }

    private String stringOrDefault(String key, String fallback) {
        String v = raw.get(key);
        return v == null || v.isBlank() ? fallback : v;
    }
}
`

const STORE_CONFIG = `package com.acme.exporter.config;

import java.util.List;

/**
 * Store-specific config slice.
 */
public class StoreConfig {

    private final String commandTopic;
    private final int commandPartitions;
    private final int ackTimeoutMs;
    private final int readTimeoutMs;

    public StoreConfig(String commandTopic, int commandPartitions, int ackTimeoutMs, int readTimeoutMs) {
        this.commandTopic = commandTopic;
        this.commandPartitions = commandPartitions;
        this.ackTimeoutMs = ackTimeoutMs;
        this.readTimeoutMs = readTimeoutMs;
    }

    public String getCommandTopic() {
        return commandTopic;
    }

    public int getCommandPartitions() {
        return commandPartitions;
    }

    public int getAckTimeoutMs() {
        return ackTimeoutMs;
    }

    public int getReadTimeoutMs() {
        return readTimeoutMs;
    }

    /**
     * Keys currently visible to the store. Backed by the command topic's
     * latest offset per partition in a real deployment.
     */
    public List<String> knownExporterKeys() {
        return List.of();
    }
}
`

const TOPIC_PROVISIONER = `package com.acme.exporter.config;

import com.acme.exporter.manager.ExporterCommand;

/**
 * Plans and applies target topic provisioning for new exporters.
 */
public class TopicProvisioner {

    private final String targetPrefix;

    public TopicProvisioner(String targetPrefix) {
        this.targetPrefix = targetPrefix;
    }

    /**
     * A provisioning plan for one exporter.
     */
    public static class Plan {
        public final String targetTopic;
        public final int partitions;

        public Plan(String targetTopic, int partitions) {
            this.targetTopic = targetTopic;
            this.partitions = partitions;
        }
    }

    /**
     * Compute the provisioning plan for a command. Null when the command
     * cannot be planned (missing partition count).
     */
    public Plan plan(ExporterCommand command) {
        if (command.getPartitionCount() == null || command.getPartitionCount() <= 0) {
            return null;
        }
        return new Plan(targetPrefix + command.getExporterId(), command.getPartitionCount());
    }

    /**
     * Apply a plan to the broker. Idempotent: re-running a plan for an
     * existing topic is a no-op.
     */
    public void apply(Plan plan) {
        // AdminClient.createTopics(...).all().get() in a real deployment.
    }
}
`

const COMMAND_CODEC = `package com.acme.exporter.store;

import java.util.Base64;

import com.acme.exporter.manager.ExporterCommand;

/**
 * Wire codec for exporter commands.
 *
 * <p>The on-wire format is a stable JSON envelope; versioning is embedded
 * so old writers can be read by new services.
 */
public class CommandCodec {

    public static final int FORMAT_VERSION = 2;

    /**
     * Serialize a command to its wire form.
     */
    public byte[] encode(ExporterCommand command) {
        String json = "{\"v\":" + FORMAT_VERSION
                + ",\"id\":" + json(command.getExporterId())
                + ",\"src\":" + json(command.getSourceTopic())
                + ",\"mode\":" + json(command.getMode())
                + ",\"parts\":" + command.getPartitionCount()
                + ",\"fp\":" + json(command.getFingerprint())
                + ",\"at\":" + command.getCreatedAt()
                + "}";
        return json.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    /**
     * Deserialize a command from its wire form.
     */
    public ExporterCommand decode(byte[] payload) {
        String json = new String(payload, java.nio.charset.StandardCharsets.UTF_8);
        ExporterCommand command = new ExporterCommand();
        command.setExporterId(unquote(field(json, "id")));
        command.setSourceTopic(unquote(field(json, "src")));
        command.setMode(unquote(field(json, "mode")));
        String parts = field(json, "parts");
        if (!parts.isEmpty()) {
            command.setPartitionCount(Integer.parseInt(parts));
        }
        command.setFingerprint(unquote(field(json, "fp")));
        return command;
    }

    /**
     * Read the latest wire form for a key.
     */
    public byte[] latestFor(String key, long timeoutMs) {
        // Consumer-based read in a real deployment.
        return null;
    }

    private static String json(String s) {
        return s == null ? "null" : "\"" + Base64.getEncoder().encodeToString(s.getBytes(java.nio.charset.StandardCharsets.UTF_8)) + "\"";
    }

    private static String unquote(String s) {
        if (s == null || s.isEmpty() || "null".equals(s)) {
            return null;
        }
        if (s.startsWith("\"") && s.endsWith("\"")) {
            s = s.substring(1, s.length() - 1);
        }
        return new String(Base64.getDecoder().decode(s), java.nio.charset.StandardCharsets.UTF_8);
    }

    private static String field(String json, String name) {
        String needle = "\"" + name + "\":";
        int i = json.indexOf(needle);
        if (i < 0) {
            return "";
        }
        int start = i + needle.length();
        int end = json.indexOf(',', start);
        if (end < 0) {
            end = json.indexOf('}', start);
        }
        return json.substring(start, end).trim();
    }
}
`

const EXPORTER_METRICS = `package com.acme.exporter.metrics;

import java.util.concurrent.atomic.AtomicLong;

/**
 * Lightweight metrics sink. In production this fans out to the metrics
 * registry; the interface is stable so the rest of the service does not
 * care which backend is attached.
 */
public class ExporterMetrics {

    private static final ExporterMetrics SHARED = new ExporterMetrics();

    private final AtomicLong publishes = new AtomicLong();
    private final AtomicLong rejections = new AtomicLong();
    private final AtomicLong successes = new AtomicLong();
    private final AtomicLong deadLetters = new AtomicLong();

    public static ExporterMetrics shared() {
        return SHARED;
    }

    public long nowNanos() {
        return System.nanoTime();
    }

    public void recordPublish(String mode, int queueDepth) {
        publishes.incrementAndGet();
    }

    public void recordRejected(String mode) {
        rejections.incrementAndGet();
    }

    public void recordSuccess(String mode) {
        successes.incrementAndGet();
    }

    public void recordRetry(String mode) {
        successes.decrementAndGet();
    }

    public void recordDeadLetter(String mode, String reason) {
        deadLetters.incrementAndGet();
    }

    public void recordPut(String mode, int partition) {
        // per-mode/per-partition histogram in a real backend
    }

    public void recordReadFailure(String key) {
        // error counter
    }

    public void recordCacheWarm(int warmed, long elapsedNanos) {
        // startup gauge
    }

    public void recordModeValidation(String source, Object mode) {
        // validation counter
    }

    public void recordCreate(String mode) {
        successes.incrementAndGet();
    }

    public void recordPersistFailure(String mode) {
        // error counter
    }

    public void recordPersistLatency(String mode, long startedNanos) {
        // latency histogram
    }

    public void recordProvisionFailure(String mode) {
        // error counter
    }

    public void recordApply(String mode, long elapsedNanos) {
        // latency histogram
    }

    public void recordFetcherRegistered(String mode) {
        // registry gauge
    }
}
`

const SOURCE_DIRECTORY = `package com.acme.exporter.config;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Registry of source topics the service is allowed to export from.
 */
public class SourceDirectory {

    private final Map<String, SourceDescriptor> sources = new ConcurrentHashMap<>();

    /**
     * Look up a source descriptor. Null when the topic is not registered.
     */
    public SourceDescriptor describe(String topic) {
        return sources.get(topic);
    }

    /**
     * Register a source. Called by the schema pipeline when a new source
     * topic is approved for export.
     */
    public void register(SourceDescriptor descriptor) {
        sources.put(descriptor.getName(), descriptor);
    }
}
`

const SOURCE_DESCRIPTOR = `package com.acme.exporter.config;

import com.acme.exporter.manager.ExporterMode;

/**
 * Static description of a source topic.
 */
public class SourceDescriptor {

    private final String name;
    private final int partitionCount;
    private final int assignedCount;
    private final java.util.Set<ExporterMode> supportedModes;

    public SourceDescriptor(String name, int partitionCount, int assignedCount,
            java.util.Set<ExporterMode> supportedModes) {
        this.name = name;
        this.partitionCount = partitionCount;
        this.assignedCount = assignedCount;
        this.supportedModes = supportedModes;
    }

    public String getName() {
        return name;
    }

    public int getPartitionCount() {
        return partitionCount;
    }

    public int getAssignedCount() {
        return assignedCount;
    }

    /**
     * Whether the source can serve the given mode.
     */
    public boolean supports(ExporterMode mode) {
        return supportedModes.contains(mode);
    }
}
`

const STARTUP_REPORT = `package com.acme.exporter.bootstrap;

import com.acme.exporter.config.ServiceConfig;

/**
 * One-line startup report emitted by the bootstrap.
 */
public class StartupReport {

    private final ServiceConfig config;
    private final long elapsedNanos;

    private StartupReport(ServiceConfig config, long elapsedNanos) {
        this.config = config;
        this.elapsedNanos = elapsedNanos;
    }

    public static StartupReport of(ServiceConfig config, long elapsedNanos) {
        return new StartupReport(config, elapsedNanos);
    }

    @Override
    public String toString() {
        return "config=" + config.size() + " properties, "
                + (elapsedNanos / 1_000_000) + " ms total";
    }
}
`

// ---------------------------------------------------------------------------
// Schema pipeline files
// ---------------------------------------------------------------------------

const SCHEMA_CONSUMER = `package com.acme.schema;

import java.util.Objects;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.acme.schema.compat.SchemaCompatibilityChecker;
import com.acme.schema.registry.SchemaRegistryClient;

/**
 * Long-running consumer for schema events.
 *
 * <p>This is the entry of the schema processing loop: an event arrives, is
 * decoded, compatibility-checked, and either registered (commit) or
 * rejected (dead-letter). The loop never blocks on a single event; poison
 * pills are fenced out by the attempt counter.
 */
public class SchemaConsumer implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(SchemaConsumer.class);

    private final BlockingQueue<SchemaEvent> queue = new LinkedBlockingQueue<>(512);
    private final SchemaCompatibilityChecker checker;
    private final SchemaRegistryClient registry;
    private final int maxAttempts;
    private volatile boolean running;

    public SchemaConsumer(SchemaCompatibilityChecker checker, SchemaRegistryClient registry, int maxAttempts) {
        this.checker = Objects.requireNonNull(checker);
        this.registry = Objects.requireNonNull(registry);
        this.maxAttempts = maxAttempts;
    }

    /**
     * Entry of the processing loop. Invoked once per event on the consumer
     * thread.
     *
     * <p>Each event is independent: failures never bleed into neighbors.
     * The three outcomes are exactly one of: committed, rejected, or
     * retried (bounded).
     */
    public void onMessage(SchemaEvent event) {
        log.info("schema event {} (subject={}, attempt={})",
                event.getId(), event.getSubject(), event.getAttempt());
        Schema schema;
        try {
            schema = decodeEvent(event);
        } catch (SchemaDecodeException e) {
            reject(event, "decode-failed", e.getMessage());
            return;
        }

        if (schema == null) {
            reject(event, "decode-empty", "no schema in event");
            return;
        }

        try {
            checker.check(schema, event.getSubject());
            registry.register(schema, event.getSubject());
            commit(event);
        } catch (SchemaRejectionException e) {
            reject(event, "rejected", e.getReason());
        } catch (RuntimeException e) {
            if (event.getAttempt() >= maxAttempts) {
                reject(event, "exhausted", e.getMessage());
            } else {
                retry(event);
            }
        }
    }

    /**
     * Decode the event payload into a schema object.
     */
    private Schema decodeEvent(SchemaEvent event) {
        String payload = event.getPayload();
        if (payload == null || payload.isBlank()) {
            return null;
        }
        if (!payload.startsWith("{")) {
            throw new SchemaDecodeException("payload is not a schema document");
        }
        return new Schema(event.getSubject(), payload);
    }

    /**
     * Commit path: the event is fully processed and will not be redelivered.
     */
    private void commit(SchemaEvent event) {
        log.info("committed schema event {} (subject={})", event.getId(), event.getSubject());
    }

    /**
     * Rejection path: the event is dead-lettered with a stable reason code.
     */
    private void reject(SchemaEvent event, String reason, String detail) {
        log.warn("rejected schema event {} ({}) : {}", event.getId(), reason, detail);
    }

    /**
     * Bounded retry: re-enqueue with an incremented attempt counter.
     */
    private void retry(SchemaEvent event) {
        queue.offer(event.withNextAttempt());
    }

    @Override
    public void close() {
        running = false;
    }
}
`

const SCHEMA_EVENT = `package com.acme.schema;

/**
 * A single schema event from the event stream.
 */
public class SchemaEvent {

    private final String id;
    private final String subject;
    private final String payload;
    private final int attempt;

    public SchemaEvent(String id, String subject, String payload, int attempt) {
        this.id = id;
        this.subject = subject;
        this.payload = payload;
        this.attempt = attempt;
    }

    public String getId() {
        return id;
    }

    public String getSubject() {
        return subject;
    }

    public String getPayload() {
        return payload;
    }

    public int getAttempt() {
        return attempt;
    }

    public SchemaEvent withNextAttempt() {
        return new SchemaEvent(id, subject, payload, attempt + 1);
    }
}
`

const SCHEMA = `package com.acme.schema;

/**
 * A decoded schema document.
 */
public class Schema {

    private final String subject;
    private final String document;

    public Schema(String subject, String document) {
        this.subject = subject;
        this.document = document;
    }

    public String getSubject() {
        return subject;
    }

    public String getDocument() {
        return document;
    }
}
`

const SCHEMA_DECODE_EXCEPTION = `package com.acme.schema;

/**
 * Raised when an event payload cannot be decoded as a schema document.
 */
public class SchemaDecodeException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public SchemaDecodeException(String message) {
        super(message);
    }
}
`

const SCHEMA_COMPATIBILITY_CHECKER = `package com.acme.schema.compat;

import com.acme.schema.Schema;
import com.acme.schema.SchemaRejectionException;

/**
 * Compatibility checking for incoming schemas.
 *
 * <p>Runs before registration: a schema that breaks backward compatibility
 * with the current subject version is rejected with a stable reason code
 * that shows up in the dead-letter log.
 */
public class SchemaCompatibilityChecker {

    /**
     * Check a schema against the current version of its subject.
     *
     * <p>Outcomes: pass (returns normally) or reject (raises
     * {@link SchemaRejectionException}). Transient registry errors propagate
     * as-is so the consumer can retry them.
     */
    public void check(Schema schema, String subject) {
        if (schema == null) {
            throw new SchemaRejectionException("missing-schema", "no schema to check");
        }
        if (subject == null || subject.isBlank()) {
            throw new SchemaRejectionException("missing-subject", "event has no subject");
        }
        if (!subject.contains("-value") && !subject.contains("-key")) {
            throw new SchemaRejectionException(
                    "bad-subject", "subject '" + subject + "' does not follow the name-value/key convention");
        }
        String document = schema.getDocument();
        if (document == null || document.length() < 4) {
            throw new SchemaRejectionException("empty-document", "schema document is empty");
        }
        if (!document.contains("\"")) {
            throw new SchemaRejectionException(
                    "not-json", "schema document is not a JSON document");
        }
        // Full Avro/Protobuf validation lives in the registry service;
        // this checker enforces the cheap structural rules locally.
    }
}
`

const SCHEMA_REJECTION_EXCEPTION = `package com.acme.schema;

/**
 * Compatibility rejection with a stable reason code.
 */
public class SchemaRejectionException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final String reason;

    public SchemaRejectionException(String reason, String message) {
        super(message);
        this.reason = reason;
    }

    public String getReason() {
        return reason;
    }
}
`

const SCHEMA_REGISTRY_CLIENT = `package com.acme.schema.registry;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import com.acme.schema.Schema;

/**
 * Client for the central schema registry.
 *
 * <p>Registration is idempotent: registering the same document twice is a
 * no-op that returns the existing id.
 */
public class SchemaRegistryClient {

    private final Map<String, Integer> registered = new ConcurrentHashMap<>();

    /**
     * Register a schema under its subject.
     *
     * <p>Called after compatibility checking passes. A registry failure
     * raises a runtime exception, which the consumer treats as retryable.
     */
    public int register(Schema schema, String subject) {
        String key = subject + "@" + hash(schema.getDocument());
        return registered.merge(key, 1, Integer::sum);
    }

    /**
     * Whether a subject has at least one registered version.
     */
    public boolean hasVersion(String subject) {
        return registered.keySet().stream().anyMatch(k -> k.startsWith(subject + "@"));
    }

    private static int hash(String s) {
        return s == null ? 0 : s.hashCode();
    }
}
`

// ---------------------------------------------------------------------------

import { buildExporterManager } from './exporter-manager.js'

export function buildSeedFiles(): SeedFile[] {
  const managerPath = `${BASE}/exporter/manager/ExporterManager.java`
  const files: SeedFile[] = [
    { path: `${BASE}/exporter/web/ExporterResource.java`, language: 'java', content: EXPORTER_RESOURCE },
    { path: `${BASE}/exporter/web/ExporterExceptionMapper.java`, language: 'java', content: EXPORTER_EXCEPTION_MAPPER },
    { path: `${BASE}/exporter/web/dto/CreateExporterRequest.java`, language: 'java', content: CREATE_EXPORTER_REQUEST },
    { path: `${BASE}/exporter/web/dto/ExporterResponse.java`, language: 'java', content: EXPORTER_RESPONSE },
    { path: `${BASE}/exporter/manager/ExporterMode.java`, language: 'java', content: EXPORTER_MODE },
    { path: `${BASE}/exporter/manager/InvalidExporterStateException.java`, language: 'java', content: INVALID_EXPORTER_STATE_EXCEPTION },
    { path: `${BASE}/exporter/manager/ExporterExistsException.java`, language: 'java', content: EXPORTER_EXISTS_EXCEPTION },
    { path: `${BASE}/exporter/manager/ExporterCommand.java`, language: 'java', content: EXPORTER_COMMAND },
    { path: managerPath, language: 'java', content: buildExporterManager() },
    { path: `${BASE}/exporter/store/KafkaExporterStore.java`, language: 'java', content: KAFKA_EXPORTER_STORE },
    { path: `${BASE}/exporter/store/CommandCodec.java`, language: 'java', content: COMMAND_CODEC },
    { path: `${BASE}/exporter/async/ExporterCommandPublisher.java`, language: 'java', content: EXPORTER_COMMAND_PUBLISHER },
    { path: `${BASE}/exporter/async/ExporterCommandEnvelope.java`, language: 'java', content: EXPORTER_COMMAND_ENVELOPE },
    { path: `${BASE}/exporter/async/ExporterCommandConsumer.java`, language: 'java', content: EXPORTER_COMMAND_CONSUMER },
    { path: `${BASE}/exporter/worker/ExporterWorker.java`, language: 'java', content: EXPORTER_WORKER },
    { path: `${BASE}/exporter/worker/ExporterWorkerException.java`, language: 'java', content: EXPORTER_WORKER_EXCEPTION },
    { path: `${BASE}/exporter/ExporterApplication.java`, language: 'java', content: EXPORTER_APPLICATION },
    { path: `${BASE}/exporter/bootstrap/BootstrapOptions.java`, language: 'java', content: BOOTSTRAP_OPTIONS },
    { path: `${BASE}/exporter/bootstrap/ExporterBootstrap.java`, language: 'java', content: EXPORTER_BOOTSTRAP },
    { path: `${BASE}/exporter/bootstrap/BootstrapException.java`, language: 'java', content: BOOTSTRAP_EXCEPTION },
    { path: `${BASE}/exporter/bootstrap/StartupReport.java`, language: 'java', content: STARTUP_REPORT },
    { path: `${BASE}/exporter/config/KafkaClientFactory.java`, language: 'java', content: KAFKA_CLIENT_FACTORY },
    { path: `${BASE}/exporter/config/ServiceConfig.java`, language: 'java', content: SERVICE_CONFIG },
    { path: `${BASE}/exporter/config/StoreConfig.java`, language: 'java', content: STORE_CONFIG },
    { path: `${BASE}/exporter/config/TopicProvisioner.java`, language: 'java', content: TOPIC_PROVISIONER },
    { path: `${BASE}/exporter/config/SourceDirectory.java`, language: 'java', content: SOURCE_DIRECTORY },
    { path: `${BASE}/exporter/config/SourceDescriptor.java`, language: 'java', content: SOURCE_DESCRIPTOR },
    { path: `${BASE}/exporter/metrics/ExporterMetrics.java`, language: 'java', content: EXPORTER_METRICS },
    { path: `${BASE}/schema/SchemaConsumer.java`, language: 'java', content: SCHEMA_CONSUMER },
    { path: `${BASE}/schema/SchemaEvent.java`, language: 'java', content: SCHEMA_EVENT },
    { path: `${BASE}/schema/Schema.java`, language: 'java', content: SCHEMA },
    { path: `${BASE}/schema/SchemaDecodeException.java`, language: 'java', content: SCHEMA_DECODE_EXCEPTION },
    { path: `${BASE}/schema/SchemaRejectionException.java`, language: 'java', content: SCHEMA_REJECTION_EXCEPTION },
    { path: `${BASE}/schema/compat/SchemaCompatibilityChecker.java`, language: 'java', content: SCHEMA_COMPATIBILITY_CHECKER },
    { path: `${BASE}/schema/registry/SchemaRegistryClient.java`, language: 'java', content: SCHEMA_REGISTRY_CLIENT },
  ]
  return files
}
