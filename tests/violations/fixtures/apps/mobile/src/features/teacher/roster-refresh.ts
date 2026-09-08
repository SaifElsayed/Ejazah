// T022 fixture — VIOLATION of R-MOBILE-11: a direct network call from a feature file. Every
// server call goes through the tRPC client in `lib/`, which is where auth, error mapping and
// the base URL live; a bare `fetch` has none of them.
// Refused by mobile/no-direct-network.
export async function refreshRoster(enrollmentId: string): Promise<unknown> {
  const response = await fetch(`https://example.invalid/roster/${enrollmentId}`);
  return response.json();
}
