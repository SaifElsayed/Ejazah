// T020 fixture support — an internal of the catalog module. Legal to import from `./index.ts`
// inside the module, illegal to reach from another module (R-API-3).
export function publishedPackageIds(): readonly string[] {
  return [];
}
