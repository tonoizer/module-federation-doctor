/**
 * Public `@tonoizer/mfdoctor/capture` entry.
 *
 * The CLI `mfdoctor runtime` file-import path is `runtime-capture-contract.ts`.
 * File/export adapters live in `runtime-capture-file.ts`. Browser attach and
 * snapshot/network fallbacks stay isolated in `runtime-capture-transports.ts`
 * and are not invoked by ordinary analysis commands. This module does not
 * inject an in-browser doctor.
 */
export {
  DEFAULT_RUNTIME_CAPTURE_LIMITS,
  HARD_RUNTIME_CAPTURE_LIMITS,
  RUNTIME_CAPTURE_CONTRACT_VERSION,
  RuntimeCaptureExportError,
  RuntimeCaptureValidationError,
  normalizeRuntimeCaptureEnvelope,
  runtimeCaptureContentDigest,
  runtimeCaptureRecordId,
  validateRuntimeCaptureEnvelope,
} from "./runtime-capture-contract.js";
export type {
  RuntimeCaptureCapabilities,
  RuntimeCaptureCapability,
  RuntimeCaptureCapabilityInfo,
  RuntimeCaptureCapabilityKind,
  RuntimeCaptureContractVersion,
  RuntimeCaptureDevtoolsRecord,
  RuntimeCaptureDevtoolsValue,
  RuntimeCaptureEnvelope,
  RuntimeCaptureErrorRecord,
  RuntimeCaptureErrorValue,
  RuntimeCaptureIdentity,
  RuntimeCaptureInstanceRecord,
  RuntimeCaptureInstanceValue,
  RuntimeCaptureLimits,
  RuntimeCaptureNetworkRecord,
  RuntimeCaptureNetworkValue,
  RuntimeCaptureObservabilityRecord,
  RuntimeCaptureRelation,
  RuntimeCaptureRelationRecord,
  RuntimeCaptureReportValue,
  RuntimeCaptureSnapshotRecord,
  RuntimeCaptureSnapshotValue,
  RuntimeCaptureSource,
  RuntimeCaptureTransport,
  RuntimeCaptureTruncation,
} from "./runtime-capture-contract.js";
export {
  detectRuntimeCaptureExport,
  importRuntimeCaptureExport,
  loadRuntimeCaptureExportFile,
  writeRuntimeCaptureExportFile,
} from "./runtime-capture-file.js";
export type {
  RuntimeCaptureExportAdapter,
  RuntimeCaptureExportKind,
  RuntimeCaptureExportOptions,
  RuntimeCaptureFileWriteResult,
} from "./runtime-capture-file.js";
export {
  captureRuntimeBrowserExport,
  importRuntimeCaptureFallback,
  importRuntimeCaptureNetworkFallback,
} from "./runtime-capture-transports.js";
export type {
  RuntimeCaptureBrowserCaptureOptions,
  RuntimeCaptureBrowserConnectOptions,
  RuntimeCaptureBrowserConnection,
  RuntimeCaptureBrowserConnector,
  RuntimeCaptureBrowserMode,
  RuntimeCaptureBrowserReadRequest,
  RuntimeCaptureBrowserScope,
  RuntimeCaptureBrowserTarget,
  RuntimeCaptureFallbackOptions,
  RuntimeCaptureNetworkFallbackOptions,
} from "./runtime-capture-transports.js";
