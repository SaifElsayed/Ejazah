// T020 fixture support — the administrative module's public entry. Nothing depends on admin,
// so even this legal-looking entry is illegal to import from another module (R-API-4).
export function auditLogIds(): readonly string[] {
  return [];
}
