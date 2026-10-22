// T074: the `restricted` route, outside the role groups; the guard lands a suspended or banned
// account here and lets it reach nothing else (lib/session.ts).
import { Restricted } from '../features/shared/account';

export default Restricted;
