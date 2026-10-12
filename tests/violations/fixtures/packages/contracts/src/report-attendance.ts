// R-TIME-6 fixture (T159): an input schema that takes the moment of attendance from the client.
import { z } from 'zod';

export const reportAttendanceInput = z.object({
  sessionId: z.string(),
  joinedAt: z.iso.datetime(),
});
