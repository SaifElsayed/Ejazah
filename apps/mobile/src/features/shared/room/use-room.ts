// T019 of specs/004-sessions: the room screen's connection (`connection.ts`), made when the screen
// opens and closed when it goes away, drawn again on every change.
import { useEffect, useState } from 'react';

import { useT } from '../../../i18n';
import { useApi } from '../../../lib/api';
import { RoomConnection, type RoomPhase, type RoomView } from './connection';

export interface RoomControls {
  readonly phase: RoomPhase;
  readonly view: RoomView | undefined;
  readonly toggleCamera: () => void;
  readonly askToShare: () => void;
  readonly cancelShare: () => void;
  readonly confirmShare: () => void;
  readonly stopShare: () => void;
  readonly retry: () => void;
  /** «الدخول من هذا الجهاز»: one `sessions.join`. */
  readonly takeBack: () => void;
  /** Leaves the room; resolves once the audio session is stopped. */
  readonly leave: () => Promise<void>;
}

const CONNECTING: RoomPhase = { kind: 'connecting' };

export function useRoom(sessionId: string): RoomControls {
  const { client } = useApi();
  const t = useT();
  const [connection, setConnection] = useState<RoomConnection | undefined>(undefined);
  const [, setVersion] = useState(0);
  useEffect(() => {
    const made = new RoomConnection(
      () => client.api.sessions.join.mutate({ sessionId }),
      () => setVersion((version) => version + 1),
    );
    setConnection(made);
    void made.start();
    return () => {
      void made.close();
    };
  }, [client, sessionId]);
  return {
    phase: connection?.phase ?? CONNECTING,
    view: connection?.view(),
    toggleCamera: () => void connection?.toggleCamera(),
    askToShare: () => connection?.askToShare(),
    cancelShare: () => connection?.cancelShare(),
    confirmShare: () =>
      void connection?.confirmShare({
        title: t('session.room.screenShare.noticeTitle'),
        text: t('session.room.screenShare.noticeText'),
      }),
    stopShare: () => void connection?.stopShare(),
    retry: () => connection?.retry(),
    takeBack: () => connection?.takeBack(),
    leave: () => connection?.close() ?? Promise.resolve(),
  };
}
