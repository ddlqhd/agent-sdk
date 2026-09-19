export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;
export const EXEC_UNAUTHORIZED = -32001;
export const EXEC_NOT_INITIALIZED = -32002;
export const EXEC_PATH_DENIED = -32003;
export const EXEC_NOT_FOUND = -32004;

export class ExecError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(message: string, code = JSON_RPC_INTERNAL_ERROR, data?: unknown) {
    super(message);
    this.name = 'ExecError';
    this.code = code;
    this.data = data;
  }
}

export class ExecPathError extends ExecError {
  constructor(message: string) {
    super(message, EXEC_PATH_DENIED);
    this.name = 'ExecPathError';
  }
}

export class ExecAuthError extends ExecError {
  constructor(message = 'Unauthorized') {
    super(message, EXEC_UNAUTHORIZED);
    this.name = 'ExecAuthError';
  }
}
