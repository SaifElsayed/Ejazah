// T071: the letter an applicant's avatar shows when there is no photo.
const TITLES = new Set(['الشيخ', 'الشيخة', 'الأستاذ', 'الأستاذة']);

/** The avatar's letter: the first of the name, past an honorific (the board's «ي» of «الشيخ ياسر»). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words.find((word) => !TITLES.has(word)) ?? words[0] ?? '';
  return [...first][0] ?? '';
}
