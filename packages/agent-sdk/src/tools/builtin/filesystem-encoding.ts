/**
 * Charset detection and encode/decode helpers for builtin filesystem tools (Read / Write / Edit).
 * Implementation lives in `@ddlqhd/agent-sdk-exec` so exec-server can decode on the execution host.
 */
export {
  detectEncodingFromSample,
  isNativeReadEncoding,
  isFilesystemEncodingSupported,
  normalizeFilesystemEncoding,
  readEncodingSample,
  readFileAsUnicodeString,
  writeFileFromUnicodeString
} from '@ddlqhd/agent-sdk-exec';
