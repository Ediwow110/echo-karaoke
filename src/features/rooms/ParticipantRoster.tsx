import type { RosterEntry } from './useRoomData';

export default function ParticipantRoster({ roster }: { roster: RosterEntry[] }) {
  return (
    <section className="panel" aria-labelledby="roster-heading">
      <h2 id="roster-heading">In the room</h2>
      <ul className="roster">
        {roster.map((member) => (
          <li key={member.memberId} className="roster-entry">
            <span className={member.online ? 'presence presence-online' : 'presence'} aria-hidden="true" />
            <span className="roster-name">{member.displayName}</span>
            {member.role === 'host' ? <span className="roster-tag">Host</span> : null}
            <span className="sr-only">{member.online ? 'Online' : 'Away'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
