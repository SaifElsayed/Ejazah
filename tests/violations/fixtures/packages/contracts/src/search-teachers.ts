// R-GENDER-4 fixture (T159): an input schema that lets the client name its own gender.
import { z } from 'zod';

export const searchTeachersInput = z.object({
  subjectId: z.string(),
  gender: z.enum(['male', 'female']),
});
