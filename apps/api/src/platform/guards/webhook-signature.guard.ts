// T133: webhook signature guard (FR-074). Verifies the gateway or provider signature on the RAW body
// before any handler runs; unsigned or invalid requests are rejected and no row is written (R-MONEY-9, R-SEC-12).
export {};
