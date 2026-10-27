import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CrownIcon } from '@phosphor-icons/react/dist/csr/Crown';
import { DoorOpenIcon } from '@phosphor-icons/react/dist/csr/DoorOpen';
import { LockKeyIcon } from '@phosphor-icons/react/dist/csr/LockKey';
import { ShieldCheckIcon } from '@phosphor-icons/react/dist/csr/ShieldCheck';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { useHostRoom } from './useHostRoom';
import { useRoomApi } from './RoomApiProvider';
import DoorList from '../features/rooms/DoorList';
import InviteCard from '../features/rooms/InviteCard';
import { setAdmissions, setApproval as requestApproval } from '../features/rooms/roomApi';
import { onlineGuestCount, presenceSummary } from '../lib/format';
import { Avatar, Button, Chip, ConfirmDialog, Toggle } from '../ui';

export default function HostSettingsPage() {
  const {
    roomId,
    roomName,
    hostName,
    code,
    joinUrl,
    roster,
    door,
    doorBusyId,
    room,
    connection,
    notify,
    refresh,
    runHost,
    approveGuest,
    rejectGuest,
    transferRoom,
    endRoom,
    removeMember,
  } = useHostRoom();
  const api = useRoomApi();
  const navigate = useNavigate();
  const [pending, setPending] = useState<'playback' | 'door' | 'approval' | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [confirmTransfer, setConfirmTransfer] = useState<{ memberId: string; displayName: string } | null>(null);
  const [transferring, setTransferring] = useState(false);
  const offline = connection === 'offline';

  async function finishTransfer(): Promise<void> {
    if (confirmTransfer === null || transferring) return;
    setTransferring(true);
    try {
      // transferRoom reports its own failures and navigates away on success, so
      // the dialog only closes when the handover actually went through.
      const handedOver = await transferRoom(confirmTransfer.memberId);
      if (handedOver) {
        setConfirmTransfer(null);
      }
    } finally {
      setTransferring(false);
    }
  }

  async function removeGuest(memberId: string): Promise<void> {
    if (removingId !== null) return;
    setRemovingId(memberId);
    try {
      await removeMember(memberId);
    } finally {
      setRemovingId(null);
    }
  }

  async function changeApproval(next: boolean): Promise<void> {
    if (pending !== null) return;
    setPending('approval');
    try {
      const result = await requestApproval(api, roomId, next);
      // Turning approval off admits whoever was waiting; say so rather than let
      // the door list quietly empty itself.
      if (result.admitted > 0) {
        notify(result.admitted === 1 ? 'Let the waiting guest in.' : 'Let ' + result.admitted + ' waiting guests in.');
      }
      await refresh();
    } catch (caught) {
      notify('The approval setting could not be changed.', caught instanceof Error ? caught.message : undefined, 'error');
    } finally {
      setPending(null);
    }
  }

  async function setGuestPlayback(next: boolean): Promise<void> {
    if (pending !== null) return;
    setPending('playback');
    try {
      await runHost(next ? 'unlock_playback' : 'lock_playback');
    } finally {
      setPending(null);
    }
  }

  async function setDoorLock(next: boolean): Promise<void> {
    if (pending !== null) return;
    setPending('door');
    try {
      await setAdmissions(api, roomId, next);
      await refresh();
    } catch (caught) {
      notify(
        next ? 'The door could not be closed.' : 'The door could not be reopened.',
        caught instanceof Error ? caught.message : undefined,
        'error',
      );
    } finally {
      setPending(null);
    }
  }

  async function finishRoom(): Promise<void> {
    setEnding(true);
    try {
      await endRoom();
    } finally {
      setEnding(false);
      setConfirmEnd(false);
    }
  }

  const guests = roster.filter((member) => member.role === 'guest');
  const host = roster.find((member) => member.role === 'host');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-gold">Room settings</p>
          <h2 className="mt-1 font-display text-[clamp(1.9rem,2.8vw,2.15rem)] font-bold leading-[1.08] tracking-[-0.03em] text-ink">
            A room that feels like yours.
          </h2>
          <p className="mt-2 text-[0.8125rem] leading-[1.6] text-ink-2">
            Permissions, people and a little peace of mind.
          </p>
        </div>
        <Chip tone={offline ? 'gold' : 'signal'}>{offline ? 'Reconnecting' : 'Only you can edit settings'}</Chip>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21.5rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="rounded-panel border border-line bg-surface p-5 sm:p-6" aria-labelledby="permissions-title">
            <p id="permissions-title" className="eyebrow text-ink-2">Guest permissions</p>
            <div className="mt-5 flex flex-col gap-5">
              <Toggle
                checked={!room.guestPlaybackLocked}
                onChange={(next) => { void setGuestPlayback(next); }}
                label="Guests can pause or resume"
                description="Off by default. Playback stays under the host's control."
                disabled={offline || pending !== null}
                busy={pending === 'playback'}
              />
              <div className="h-px bg-line" aria-hidden="true" />
              <Toggle
                checked={room.requireApproval === true}
                onChange={(next) => { void changeApproval(next); }}
                label="Approve each guest"
                description="On by default. New guests wait at the door; turning this off lets whoever is already waiting in."
                disabled={offline || pending !== null}
                busy={pending === 'approval'}
              />
              <div className="h-px bg-line" aria-hidden="true" />
              <Toggle
                checked={room.admissionsLocked === true}
                onChange={(next) => { void setDoorLock(next); }}
                label="Close the door to new guests"
                description="Anyone already in stays. New people are turned away until you reopen it."
                disabled={offline || pending !== null}
                busy={pending === 'door'}
              />
              <div className="h-px bg-line" aria-hidden="true" />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[0.875rem] font-semibold text-ink">Skip, remove and reorder</p>
                  <p className="mt-1 text-[0.75rem] leading-[1.55] text-ink-2">
                    Guests cannot change the running order, even when their other controls are on.
                  </p>
                </div>
                <Chip tone="signal">Host only</Chip>
              </div>
            </div>
            <div className="mt-5 flex items-start gap-2 rounded-media border border-line bg-graphite/60 px-3.5 py-3">
              <LockKeyIcon size={15} className="mt-0.5 shrink-0 text-ink-2" aria-hidden="true" />
              <p className="text-[0.6875rem] leading-[1.6] text-ink-2">
                Host moderation stays active while the room is live. Changes apply to every remote on the next refresh.
              </p>
            </div>
          </section>

          <section className="rounded-panel border border-line bg-surface p-5 sm:p-6" aria-labelledby="door-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <DoorOpenIcon size={18} className="text-signal" aria-hidden="true" />
                <h3 id="door-title" className="font-display text-[1.35rem] font-bold tracking-[-0.02em] text-ink">At the door</h3>
              </div>
              <span className="text-[0.6875rem] text-ink-2">
                {door.length} {door.length === 1 ? 'guest waiting' : 'guests waiting'}
              </span>
            </div>
            <div className="mt-4">
              <DoorList door={door} busyId={doorBusyId} onApprove={approveGuest} onReject={rejectGuest} />
            </div>
          </section>

          <section className="rounded-panel border border-line bg-surface p-5 sm:p-6" aria-labelledby="people-title">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <UsersThreeIcon size={18} className="text-signal" aria-hidden="true" />
                <h3 id="people-title" className="font-display text-[1.35rem] font-bold tracking-[-0.02em] text-ink">In the room</h3>
              </div>
              <span className="text-[0.6875rem] text-ink-2">{presenceSummary(roster)}</span>
            </div>
            <ul className="mt-4 divide-y divide-line">
              {host === undefined ? null : (
                <li className="stagger-in flex items-center gap-3 py-3 first:pt-0">
                  <Avatar name={host.displayName} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.8125rem] font-semibold text-ink">{host.displayName} {hostName === host.displayName ? '(you)' : ''}</p>
                    <p className="mt-0.5 text-[0.6875rem] text-ink-2">Host · This screen</p>
                  </div>
                  <Chip tone="gold">Host</Chip>
                  <span className="size-1.5 rounded-full bg-live" aria-label="Online" />
                </li>
              )}
              {guests.map((member, index) => (
                <li
                  key={member.memberId}
                  className="stagger-in flex items-center gap-3 py-3 last:pb-0"
                  style={{ animationDelay: (index + 1) * 40 + 'ms' }}
                >
                  <Avatar name={member.displayName} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.8125rem] font-semibold text-ink">{member.displayName}</p>
                    <p className="mt-0.5 text-[0.6875rem] text-ink-2">
                      Guest · {member.online ? 'Phone remote connected' : 'Away'}
                    </p>
                  </div>
                  <span className={['size-1.5 rounded-full', member.online ? 'bg-live' : 'bg-ink-3'].join(' ')} aria-label={member.online ? 'Online' : 'Away'} />
                  <button
                    type="button"
                    onClick={() => setConfirmTransfer({ memberId: member.memberId, displayName: member.displayName })}
                    disabled={offline || !member.online || transferring || removingId !== null}
                    aria-label={'Hand the room to ' + member.displayName}
                    title={member.online
                      ? 'Hand this room to ' + member.displayName
                      : member.displayName + '’s remote is not connected, so they cannot take the room'}
                    className="grid size-11 shrink-0 place-items-center rounded-full text-ink-3 transition-[background-color,color,transform,scale] active:scale-95 hover:bg-surface-2 hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:pointer-events-none disabled:opacity-35"
                  >
                    <CrownIcon size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeGuest(member.memberId)}
                    disabled={offline || removingId !== null}
                    aria-label={'Remove ' + member.displayName + ' from the room'}
                    className="grid size-11 shrink-0 place-items-center rounded-full text-ink-3 transition-[background-color,color,transform,scale] active:scale-95 hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:pointer-events-none disabled:opacity-35"
                  >
                    <XIcon size={15} weight="bold" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            {guests.length === 0 ? (
              <p className="mt-3 text-[0.75rem] leading-[1.6] text-ink-2">
                Share the room QR to bring the first phone in.
              </p>
            ) : null}
            <p className="mt-4 border-t border-line pt-3 text-[0.6875rem] leading-[1.6] text-ink-2">
              Guests keep their name and queue while they stay in the room. Remove a guest to free their slot and their songs. Skipping and moderation stay with you.
            </p>
          </section>

          <section className="rounded-panel border border-line bg-surface p-5 sm:p-6" aria-labelledby="end-title">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-[38ch]">
                <div className="flex items-center gap-2">
                  <ShieldCheckIcon size={18} className="text-signal" aria-hidden="true" />
                  <h3 id="end-title" className="font-display text-[1.3rem] font-bold tracking-[-0.02em] text-ink">Done for the night?</h3>
                </div>
                <p className="mt-2 text-[0.75rem] leading-[1.65] text-ink-2">
                  Ending the room stops playback and closes the queue for every remote. Leaving this screen keeps the room open.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  icon={<SignOutIcon size={15} />}
                  onClick={() => navigate('/')}
                >
                  Leave screen
                </Button>
                <Button
                  variant="danger"
                  size="md"
                  icon={<DoorOpenIcon size={15} />}
                  onClick={() => setConfirmEnd(true)}
                  disabled={offline}
                >
                  Leave & end room
                </Button>
              </div>
            </div>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <InviteCard
            roomName={roomName}
            code={code}
            hostName={hostName}
            joinUrl={joinUrl}
            guests={onlineGuestCount(roster)}
            variant="compact"
          />
          <section className="rounded-panel border border-line bg-surface p-5">
            <p className="eyebrow text-ink-2">Room access</p>
            <dl className="mt-3 flex flex-col gap-3 text-[0.75rem]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-2">Room</dt>
                <dd className="truncate font-semibold text-ink">{roomName}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-2">Room link</dt>
                <dd className="text-ink">{joinUrl.length > 0 ? 'Live' : 'Unavailable'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-2">Guest adds</dt>
                <dd className={room.guestControlLocked ? 'text-ink-2' : 'text-live'}>{room.guestControlLocked ? 'Off' : 'On'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-2">Guest playback</dt>
                <dd className={room.guestPlaybackLocked ? 'text-ink-2' : 'text-live'}>{room.guestPlaybackLocked ? 'Host only' : 'Allowed'}</dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-line pt-3 text-[0.625rem] leading-[1.6] text-ink-2">
              The room stays live until you end it. Keep this screen open to keep hosting.
            </p>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmTransfer !== null}
        title={'Hand the room to ' + (confirmTransfer?.displayName ?? '') + '?'}
        description="You become a guest. Their screen becomes the room: video, audio, skipping and the queue order all move to them. You can still add songs and vote."
        confirmLabel="Hand it over"
        cancelLabel="Keep hosting"
        busy={transferring}
        onConfirm={() => { void finishTransfer(); }}
        onCancel={() => setConfirmTransfer(null)}
      />
      <ConfirmDialog
        open={confirmEnd}
        title="End the room?"
        description="Playback stops, the queue closes, and every remote loses access. This cannot be undone."
        confirmLabel="End the room"
        cancelLabel="Keep it open"
        busy={ending}
        onConfirm={() => { void finishRoom(); }}
        onCancel={() => setConfirmEnd(false)}
      />
      <p className="sr-only" aria-live="polite">Room ID {roomId}</p>
    </div>
  );
}
