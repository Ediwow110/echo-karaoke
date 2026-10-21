import { UsersThreeIcon } from '@phosphor-icons/react';
import type { RosterEntry } from './useRoomData';
import { Panel, RosterRow } from '../../ui';

export default function ParticipantRoster({ roster }: { roster: RosterEntry[] }) {
  return (
    <Panel title="In the room" icon={<UsersThreeIcon size={18} weight="duotone" />}>
      <ul className="flex flex-wrap gap-2">
        {roster.map((member) => (
          <RosterRow
            key={member.memberId}
            name={member.displayName}
            online={member.online}
            isHost={member.role === 'host'}
          />
        ))}
      </ul>
    </Panel>
  );
}
