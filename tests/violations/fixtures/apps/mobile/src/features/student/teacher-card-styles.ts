// T022 fixture — VIOLATION of R-MOBILE-4: a raw hex colour in a feature file. Colour exists in
// `design/` and reaches a feature as a token; a literal here is a second source of truth.
// Refused by mobile/no-raw-color.
export const teacherCardStyles = {
  backgroundColor: '#0f766e',
};
