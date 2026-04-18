// Mock for `server-only` package — allows server-only modules to be imported in vitest tests.
// The real package throws at import time if not in a server context; this no-ops it.
export {};
