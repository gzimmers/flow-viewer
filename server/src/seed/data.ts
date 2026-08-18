// Seed flows, expressed in the exact agent publish payload shape.
// Regions are computed from content anchors so they always match the source.

import type { PublishPayload } from '../types.js'
import { buildSeedFiles, type SeedFile } from './java-files.js'
import { EXPORTER_MANAGER_PATH } from './exporter-manager.js'
import { regionOf, classRegionOf, type Region } from './regions.js'

function lineOf(content: string, needle: string): number {
  const i = content.split('\n').findIndex((l) => l.includes(needle))
  if (i < 0) throw new Error(`line anchor not found: ${needle}`)
  return i + 1
}

const P = (path: string) => path
const M = 'src/main/java/com/acme/exporter/manager'
const W = 'src/main/java/com/acme/exporter/web'
const S = 'src/main/java/com/acme/exporter/store'
const A = 'src/main/java/com/acme/exporter/async'
const K = 'src/main/java/com/acme/exporter/worker'
const B = 'src/main/java/com/acme/exporter'
const SC = 'src/main/java/com/acme/schema'

interface NodeSpec {
  key: string
  sortOrder: number
  kind?: string
  label: string
  symbol?: string
  file?: string
  region?: Region
  line?: number
  exitStatus?: string
  exitLabel?: string
  meta?: unknown
}

interface EdgeSpec {
  from: string
  to: string
  kind?: string
  label?: string
}

function toNode(n: NodeSpec) {
  const base: Record<string, unknown> = {
    key: n.key,
    sortOrder: n.sortOrder,
    kind: n.kind ?? 'call',
    label: n.label,
    symbol: n.symbol,
    file: n.file,
  }
  if (n.region) {
    base.startLine = n.region.start
    base.endLine = n.region.end
  } else if (n.line) {
    base.startLine = n.line
    base.endLine = n.line
  }
  if (n.exitStatus) base.exitStatus = n.exitStatus
  if (n.exitLabel) base.exitLabel = n.exitLabel
  if (n.meta != null) base.meta = n.meta
  return base
}

function buildCreateExporter(files: Map<string, SeedFile>): PublishPayload {
  const f = (p: string) => files.get(p)?.content
  if (!f) throw new Error('files not built')

  const resource = f(P(`${W}/ExporterResource.java`))!
  const request = f(P(`${W}/dto/CreateExporterRequest.java`))!
  const mapper = f(P(`${W}/ExporterExceptionMapper.java`))!
  const invState = f(P(`${M}/InvalidExporterStateException.java`))!
  const existsEx = f(P(`${M}/ExporterExistsException.java`))!
  const manager = f(EXPORTER_MANAGER_PATH)!
  const store = f(P(`${S}/KafkaExporterStore.java`))!
  const publisher = f(P(`${A}/ExporterCommandPublisher.java`))!
  const consumer = f(P(`${A}/ExporterCommandConsumer.java`))!
  const worker = f(P(`${K}/ExporterWorker.java`))!

  const nodes: NodeSpec[] = [
    {
      key: 'entry', sortOrder: 1, kind: 'entry',
      label: 'POST /exporters',
      symbol: 'createExporter',
      file: P(`${W}/ExporterResource.java`),
      region: regionOf(resource, 'public Response createExporter'),
      meta: {
        protocol: 'http',
        method: 'POST',
        path: '/exporters',
        contentType: 'application/json',
        requestModel: 'CreateExporterRequest',
        handler: 'ExporterResource.createExporter()',
      },
    },
    {
      key: 'parse', sortOrder: 2,
      label: 'Bind request body',
      symbol: 'CreateExporterRequest',
      file: P(`${W}/dto/CreateExporterRequest.java`),
      region: classRegionOf(request, 'public class CreateExporterRequest'),
    },
    {
      key: 'delegate', sortOrder: 3,
      label: 'Delegate to ExporterManager',
      file: P(`${W}/ExporterResource.java`),
      line: lineOf(resource, 'manager.create(request)'),
    },
    {
      key: 'create', sortOrder: 4,
      label: 'ExporterManager.create()',
      symbol: 'create',
      file: EXPORTER_MANAGER_PATH,
      region: regionOf(manager, 'public ExporterCommand create('),
    },
    {
      key: 'validate', sortOrder: 5, kind: 'branch',
      label: 'Validate export mode',
      symbol: 'validateMode',
      file: EXPORTER_MANAGER_PATH,
      region: regionOf(manager, 'void validateMode('),
      meta: { outcomes: ['valid', 'invalid'] },
    },
    {
      key: 'throwInvalid', sortOrder: 6,
      label: 'Throw InvalidExporterStateException',
      symbol: 'InvalidExporterStateException',
      file: P(`${M}/InvalidExporterStateException.java`),
      region: classRegionOf(invState, 'public class InvalidExporterStateException'),
    },
    {
      key: 'existsCheck', sortOrder: 7, kind: 'branch',
      label: 'Exporter already exists?',
      file: EXPORTER_MANAGER_PATH,
      line: lineOf(manager, 'if (exists(exporterId)) {'),
      meta: { outcomes: ['new', 'exists'] },
    },
    {
      key: 'throwExists', sortOrder: 8,
      label: 'Throw ExporterExistsException',
      symbol: 'ExporterExistsException',
      file: P(`${M}/ExporterExistsException.java`),
      region: classRegionOf(existsEx, 'public class ExporterExistsException'),
    },
    {
      key: 'persist', sortOrder: 9,
      label: 'Persist command to store',
      symbol: 'persist',
      file: EXPORTER_MANAGER_PATH,
      region: regionOf(manager, 'private void persist('),
    },
    {
      key: 'storePut', sortOrder: 10,
      label: 'KafkaExporterStore.put()',
      symbol: 'put',
      file: P(`${S}/KafkaExporterStore.java`),
      region: regionOf(store, 'public void put(ExporterCommand'),
    },
    {
      key: 'publish', sortOrder: 11, kind: 'async',
      label: 'Publish command to async queue',
      symbol: 'publish',
      file: P(`${A}/ExporterCommandPublisher.java`),
      region: regionOf(publisher, 'public void publish('),
      meta: { boundary: 'http-thread -> worker-pool', queue: 'exporter-commands' },
    },
    {
      key: 'consume', sortOrder: 12, kind: 'async',
      label: 'Consumer processes command',
      symbol: 'onMessage',
      file: P(`${A}/ExporterCommandConsumer.java`),
      region: regionOf(consumer, 'public void onMessage('),
    },
    {
      key: 'work', sortOrder: 13,
      label: 'Worker provisions exporter',
      symbol: 'process',
      file: P(`${K}/ExporterWorker.java`),
      region: regionOf(worker, 'public void process('),
    },
    {
      key: 'apply', sortOrder: 14,
      label: 'Transition exporter to ACTIVE',
      symbol: 'apply',
      file: P(`${K}/ExporterWorker.java`),
      region: regionOf(worker, 'public void apply('),
    },
    {
      key: 'exit201', sortOrder: 15, kind: 'exit',
      label: '201 Created',
      file: P(`${W}/ExporterResource.java`),
      region: regionOf(resource, 'private Response buildCreatedResponse'),
      exitStatus: '201',
      exitLabel: '201 Created',
    },
    {
      key: 'exit400', sortOrder: 16, kind: 'exit',
      label: '400 Invalid Request',
      symbol: 'mapBadRequest',
      file: P(`${W}/ExporterExceptionMapper.java`),
      region: regionOf(mapper, 'public Response mapBadRequest'),
      exitStatus: '400',
      exitLabel: '400 Invalid Request',
    },
    {
      key: 'exit409', sortOrder: 17, kind: 'exit',
      label: '409 Exporter Exists',
      symbol: 'mapExists',
      file: P(`${W}/ExporterExceptionMapper.java`),
      region: regionOf(mapper, 'public Response mapExists'),
      exitStatus: '409',
      exitLabel: '409 Exporter Exists',
    },
    {
      key: 'exit422', sortOrder: 18, kind: 'exit',
      label: '422 Invalid State',
      symbol: 'mapInvalidState',
      file: P(`${W}/ExporterExceptionMapper.java`),
      region: regionOf(mapper, 'public Response mapInvalidState'),
      exitStatus: '422',
      exitLabel: '422 Invalid State',
    },
    {
      key: 'exit500', sortOrder: 19, kind: 'exit',
      label: '500 Internal Error',
      symbol: 'mapInternal',
      file: P(`${W}/ExporterExceptionMapper.java`),
      region: regionOf(mapper, 'public Response mapInternal'),
      exitStatus: '500',
      exitLabel: '500 Internal Error',
    },
  ]

  const edges: EdgeSpec[] = [
    { from: 'entry', to: 'parse', kind: 'sync' },
    { from: 'parse', to: 'delegate', kind: 'sync' },
    { from: 'parse', to: 'exit400', kind: 'error', label: 'bind failure' },
    { from: 'delegate', to: 'create', kind: 'sync' },
    { from: 'create', to: 'validate', kind: 'sync', label: 'validateMode()' },
    { from: 'create', to: 'exit500', kind: 'error', label: 'unexpected' },
    { from: 'validate', to: 'existsCheck', kind: 'branch', label: 'valid' },
    { from: 'validate', to: 'throwInvalid', kind: 'branch', label: 'invalid' },
    { from: 'throwInvalid', to: 'exit422', kind: 'error' },
    { from: 'existsCheck', to: 'persist', kind: 'branch', label: 'new' },
    { from: 'existsCheck', to: 'throwExists', kind: 'branch', label: 'exists' },
    { from: 'throwExists', to: 'exit409', kind: 'error' },
    { from: 'persist', to: 'storePut', kind: 'sync', label: 'store.put()' },
    { from: 'storePut', to: 'publish', kind: 'sync', label: 'command built' },
    { from: 'publish', to: 'exit201', kind: 'sync', label: 'return 201' },
    { from: 'publish', to: 'consume', kind: 'async', label: 'kafka: exporter-commands' },
    { from: 'consume', to: 'work', kind: 'sync' },
    { from: 'work', to: 'apply', kind: 'sync' },
  ]

  return {
    name: 'Create Exporter',
    description:
      'Synchronous HTTP creation path: request binding, mode validation, existence check, Kafka persistence, then the async handoff to the worker pool that provisions the exporter. Exits: 201, 400, 409, 422, 500.',
    type: 'http',
    branch: 'main',
    tags: ['http', 'exporter', 'async'],
    repository: {
      name: 'acme/exporter-service',
      url: 'git@example.com:acme/exporter-service.git',
      defaultBranch: 'main',
    },
    files: [
      { path: P(`${W}/ExporterResource.java`), language: 'java', content: resource },
      { path: P(`${W}/ExporterExceptionMapper.java`), language: 'java', content: mapper },
      { path: P(`${W}/dto/CreateExporterRequest.java`), language: 'java', content: request },
      { path: P(`${M}/InvalidExporterStateException.java`), language: 'java', content: invState },
      { path: P(`${M}/ExporterExistsException.java`), language: 'java', content: existsEx },
      { path: EXPORTER_MANAGER_PATH, language: 'java', content: manager },
      { path: P(`${S}/KafkaExporterStore.java`), language: 'java', content: store },
      { path: P(`${A}/ExporterCommandPublisher.java`), language: 'java', content: publisher },
      { path: P(`${A}/ExporterCommandConsumer.java`), language: 'java', content: consumer },
      { path: P(`${K}/ExporterWorker.java`), language: 'java', content: worker },
    ],
    nodes: nodes.map(toNode) as PublishPayload['nodes'],
    edges: edges.map((e) => ({ ...e })) as PublishPayload['edges'],
  }
}

function buildStartup(files: Map<string, SeedFile>): PublishPayload {
  const app = files.get(P(`${B}/ExporterApplication.java`))!.content
  const bootstrap = files.get(P(`${B}/bootstrap/ExporterBootstrap.java`))!.content
  const bex = files.get(P(`${B}/bootstrap/BootstrapException.java`))!.content
  const factory = files.get(P(`${B}/config/KafkaClientFactory.java`))!.content
  const store = files.get(P(`${S}/KafkaExporterStore.java`))!.content
  const consumer = files.get(P(`${A}/ExporterCommandConsumer.java`))!.content

  const nodes: NodeSpec[] = [
    {
      key: 'entry', sortOrder: 1, kind: 'entry',
      label: 'Application.main',
      symbol: 'main',
      file: P(`${B}/ExporterApplication.java`),
      region: regionOf(app, 'public static void main'),
      meta: { protocol: 'process', handler: 'ExporterApplication.main()' },
    },
    {
      key: 'bootstrap', sortOrder: 2,
      label: 'Bootstrap.run',
      symbol: 'run',
      file: P(`${B}/bootstrap/ExporterBootstrap.java`),
      region: regionOf(bootstrap, 'public void run()'),
    },
    {
      key: 'producer', sortOrder: 3,
      label: 'Create Kafka producer',
      symbol: 'createProducer',
      file: P(`${B}/config/KafkaClientFactory.java`),
      region: regionOf(factory, 'public void createProducer'),
    },
    {
      key: 'warm', sortOrder: 4,
      label: 'Warm store cache',
      symbol: 'warmUp',
      file: P(`${S}/KafkaExporterStore.java`),
      region: regionOf(store, 'public void warmUp'),
    },
    {
      key: 'pipeline', sortOrder: 5,
      label: 'Start async pipeline',
      symbol: 'init',
      file: P(`${A}/ExporterCommandConsumer.java`),
      region: regionOf(consumer, 'public void init()'),
    },
    {
      key: 'ready', sortOrder: 6,
      label: 'Mark service ready',
      symbol: 'markReady',
      file: P(`${B}/bootstrap/ExporterBootstrap.java`),
      region: regionOf(bootstrap, 'private void markReady'),
    },
    {
      key: 'throwBootstrap', sortOrder: 7,
      label: 'BootstrapException',
      symbol: 'BootstrapException',
      file: P(`${B}/bootstrap/BootstrapException.java`),
      region: classRegionOf(bex, 'public class BootstrapException'),
    },
    {
      key: 'exitOk', sortOrder: 8, kind: 'exit',
      label: 'Startup OK',
      file: P(`${B}/ExporterApplication.java`),
      line: lineOf(app, 'code = 0;'),
      exitStatus: 'OK',
      exitLabel: 'exit code 0',
    },
    {
      key: 'exitFail', sortOrder: 9, kind: 'exit',
      label: 'Startup failed',
      file: P(`${B}/ExporterApplication.java`),
      line: lineOf(app, 'code = 1;'),
      exitStatus: 'FAIL',
      exitLabel: 'exit code 1',
    },
  ]

  const edges: EdgeSpec[] = [
    { from: 'entry', to: 'bootstrap', kind: 'sync' },
    { from: 'bootstrap', to: 'producer', kind: 'sync', label: 'step 2/5' },
    { from: 'producer', to: 'warm', kind: 'sync', label: 'step 3/5' },
    { from: 'warm', to: 'pipeline', kind: 'branch', label: 'healthy' },
    { from: 'warm', to: 'throwBootstrap', kind: 'branch', label: 'failed step' },
    { from: 'pipeline', to: 'ready', kind: 'sync', label: 'step 5/5' },
    { from: 'ready', to: 'exitOk', kind: 'sync' },
    { from: 'throwBootstrap', to: 'exitFail', kind: 'error' },
    { from: 'bootstrap', to: 'exitFail', kind: 'error', label: 'any step fails' },
  ]

  return {
    name: 'Exporter Startup',
    description:
      'Process bootstrap: config load, Kafka producer, store warm-up, async pipeline start, readiness. All-or-nothing; any failed step exits the process with code 1.',
    type: 'startup',
    branch: 'main',
    tags: ['startup', 'lifecycle'],
    repository: {
      name: 'acme/exporter-service',
      url: 'git@example.com:acme/exporter-service.git',
      defaultBranch: 'main',
    },
    files: [
      { path: P(`${B}/ExporterApplication.java`), language: 'java', content: app },
      { path: P(`${B}/bootstrap/ExporterBootstrap.java`), language: 'java', content: bootstrap },
      { path: P(`${B}/bootstrap/BootstrapException.java`), language: 'java', content: bex },
      { path: P(`${B}/config/KafkaClientFactory.java`), language: 'java', content: factory },
      { path: P(`${S}/KafkaExporterStore.java`), language: 'java', content: store },
      { path: P(`${A}/ExporterCommandConsumer.java`), language: 'java', content: consumer },
    ],
    nodes: nodes.map(toNode) as PublishPayload['nodes'],
    edges: edges.map((e) => ({ ...e })) as PublishPayload['edges'],
  }
}

function buildSchemaLoop(files: Map<string, SeedFile>): PublishPayload {
  const consumer = files.get(P(`${SC}/SchemaConsumer.java`))!.content
  const checker = files.get(P(`${SC}/compat/SchemaCompatibilityChecker.java`))!.content
  const registry = files.get(P(`${SC}/registry/SchemaRegistryClient.java`))!.content
  const rejection = files.get(P(`${SC}/SchemaRejectionException.java`))!.content

  const nodes: NodeSpec[] = [
    {
      key: 'entry', sortOrder: 1, kind: 'entry',
      label: 'kafka: schema-events',
      symbol: 'onMessage',
      file: P(`${SC}/SchemaConsumer.java`),
      region: regionOf(consumer, 'public void onMessage'),
      meta: { protocol: 'kafka', topic: 'schema-events', handler: 'SchemaConsumer.onMessage()' },
    },
    {
      key: 'decode', sortOrder: 2,
      label: 'Decode event',
      symbol: 'decodeEvent',
      file: P(`${SC}/SchemaConsumer.java`),
      region: regionOf(consumer, 'private Schema decodeEvent'),
    },
    {
      key: 'check', sortOrder: 3, kind: 'branch',
      label: 'Compatibility check',
      symbol: 'check',
      file: P(`${SC}/compat/SchemaCompatibilityChecker.java`),
      region: regionOf(checker, 'public void check('),
      meta: { outcomes: ['compatible', 'incompatible'] },
    },
    {
      key: 'register', sortOrder: 4,
      label: 'Register schema',
      symbol: 'register',
      file: P(`${SC}/registry/SchemaRegistryClient.java`),
      region: regionOf(registry, 'public int register('),
    },
    {
      key: 'reject', sortOrder: 5,
      label: 'SchemaRejectionException',
      symbol: 'SchemaRejectionException',
      file: P(`${SC}/SchemaRejectionException.java`),
      region: classRegionOf(rejection, 'public class SchemaRejectionException'),
    },
    {
      key: 'exitCommitted', sortOrder: 6, kind: 'exit',
      label: 'Committed',
      symbol: 'commit',
      file: P(`${SC}/SchemaConsumer.java`),
      region: regionOf(consumer, 'private void commit'),
      exitStatus: 'OK',
      exitLabel: 'offset committed',
    },
    {
      key: 'exitRejected', sortOrder: 7, kind: 'exit',
      label: 'Dead-lettered',
      symbol: 'reject',
      file: P(`${SC}/SchemaConsumer.java`),
      region: regionOf(consumer, 'private void reject'),
      exitStatus: 'DLQ',
      exitLabel: 'dead-letter queue',
    },
  ]

  const edges: EdgeSpec[] = [
    { from: 'entry', to: 'decode', kind: 'sync' },
    { from: 'decode', to: 'check', kind: 'sync', label: 'schema decoded' },
    { from: 'decode', to: 'exitRejected', kind: 'error', label: 'decode failed' },
    { from: 'check', to: 'register', kind: 'branch', label: 'compatible' },
    { from: 'check', to: 'reject', kind: 'branch', label: 'incompatible' },
    { from: 'register', to: 'exitCommitted', kind: 'sync' },
    { from: 'reject', to: 'exitRejected', kind: 'error' },
  ]

  return {
    name: 'Schema Processing Loop',
    description:
      'Long-running consumer loop for schema events: decode, compatibility check, register or dead-letter. Events are independent; failures are fenced by an attempt counter.',
    type: 'async',
    branch: 'main',
    tags: ['kafka', 'async', 'schema'],
    repository: {
      name: 'acme/exporter-service',
      url: 'git@example.com:acme/exporter-service.git',
      defaultBranch: 'main',
    },
    files: [
      { path: P(`${SC}/SchemaConsumer.java`), language: 'java', content: consumer },
      { path: P(`${SC}/compat/SchemaCompatibilityChecker.java`), language: 'java', content: checker },
      { path: P(`${SC}/registry/SchemaRegistryClient.java`), language: 'java', content: registry },
      { path: P(`${SC}/SchemaRejectionException.java`), language: 'java', content: rejection },
    ],
    nodes: nodes.map(toNode) as PublishPayload['nodes'],
    edges: edges.map((e) => ({ ...e })) as PublishPayload['edges'],
  }
}

export function buildSeedFlows(): PublishPayload[] {
  const files = new Map<string, SeedFile>()
  for (const f of buildSeedFiles()) files.set(f.path, f)
  return [buildCreateExporter(files), buildStartup(files), buildSchemaLoop(files)]
}
