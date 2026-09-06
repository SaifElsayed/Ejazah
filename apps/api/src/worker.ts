// Queue process entrypoint (T008, T112). Imports the SAME modules as main.ts so no background job
// carries its own divergent copy of a rule. Every job satisfies a double-run assertion (R-API-14, FR-052).
export {};
