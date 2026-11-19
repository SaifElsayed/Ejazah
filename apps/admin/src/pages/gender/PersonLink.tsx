// 005:T023 (B49; the note under T023, Q-R1 (a)): a person in the reports and gender flags pages,
// a link to their record on the users page (`/users?user=<id>`). The reads carry ids only, so the
// link reads the account's id, written left to right; names are the design window's.
import { useNavigate } from 'react-router';

import { TextLink } from '../../design/components';

export function PersonLink({ userId }: { readonly userId: string }) {
  const navigate = useNavigate();
  const href = `/users?user=${userId}`;
  return (
    <span className="ltr">
      <TextLink label={userId} href={href} onPress={() => void navigate(href)} />
    </span>
  );
}
