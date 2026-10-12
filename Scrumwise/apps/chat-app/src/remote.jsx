// Micro-frontend: chat — channels inside a space, and direct messages.
import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ask, Avatar, CloseButton, createRemote, emit, fields, firstName, Icon, Modal, navigate, session, Time, useUsers } from '@scrumwise/ui';
import { changeRequested, closed, CREATE_CHANNEL, DELETE_CONVERSATION, EMOJI, HIDE, MUTE, refreshRequested, membersRequested, messageDeleted, messageEdited, messageSent, OPEN_DM, opened, QUICK_EMOJI, reactionToggled, replyCancelled, replyStarted, store } from './store.js';
import { Composer, TYPING_EMOJI } from './Composer.jsx';
import { plain, Rich } from './rich.jsx';


// Brings the quoted message into view and flashes it, so it is clear which one was meant.
function showMessage(id) {
  const el = document.getElementById(`m-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth; // makes the browser notice the class went away, so the highlight can play again
  el.classList.add('flash');
}

// The box that replaces a message while you edit it: room to type, an emoji button,
// then ✕ to cancel and ✓ to save. Enter saves, Shift+Enter starts a new line, Esc cancels.
function EditBox({ m, onDone }) {
  const dispatch = useDispatch();
  const [text, setText] = useState(m.text);
  const [picking, setPicking] = useState(false);
  const area = useRef();

  useEffect(() => { // start with the cursor at the end of the text
    area.current.focus();
    area.current.setSelectionRange(area.current.value.length, area.current.value.length);
  }, []);
  useEffect(() => { // the box grows with the text
    area.current.style.height = 'auto';
    area.current.style.height = `${area.current.scrollHeight}px`;
  }, [text]);

  const save = () => {
    const next = text.trim();
    if (!next) return;
    if (next !== m.text) dispatch(messageEdited({ id: m.id, text: next }));
    onDone();
  };
  const insert = (emoji) => {
    const el = area.current;
    const at = el.selectionStart ?? text.length;
    setText(text.slice(0, at) + emoji + text.slice(el.selectionEnd ?? at));
    setPicking(false);
    setTimeout(() => { el.focus(); el.setSelectionRange(at + emoji.length, at + emoji.length); });
  };
  const keys = (e) => {
    if (e.key === 'Escape') onDone();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
  };

  return (
    <div className="edit-wrap">
      <form className="edit-box" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <textarea ref={area} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys} aria-label="Edit your message" />
        <div className="edit-tools">
          <button type="button" className="tool" onClick={() => setPicking(!picking)} title="Add an emoji" aria-label="Add an emoji" aria-expanded={picking}><Icon name="smile" /></button>
          <span className="tool-sep" />
          <button type="button" className="tool" onClick={onDone} title="Cancel (Esc)" aria-label="Cancel editing"><Icon name="x" /></button>
          <button className="tool save" disabled={!text.trim()} title="Save (Enter)" aria-label="Save the change"><Icon name="check" /></button>
          {picking && <div className="tool-pop emoji-grid" role="menu">{TYPING_EMOJI.map((emoji) => <button type="button" key={emoji} onClick={() => insert(emoji)} aria-label={`Insert ${emoji}`}>{emoji}</button>)}</div>}
        </div>
      </form>
      <p className="edit-hint"><b>Shift+Enter</b> starts a new line.</p>
    </div>
  );
}

// One message: the quote it answers, its text, reactions and "seen" mark,
// and the toolbar that appears over it when you point at it.
function MessageRow({ m, channel, users, me }) {
  const dispatch = useDispatch();
  const [mode, setMode] = useState(null); // 'edit', 'delete', 'react' (all reactions) or 'more' (the … menu)
  const mine = m.from === me.id;
  const dm = channel.kind === 'dm';
  const others = channel.members.filter((id) => id !== me.id);
  // Everyone whose last visit to the conversation was after this message was sent has seen it.
  const seenBy = mine ? channel.reads.filter((r) => r.user !== me.id && r.at >= m.at).map((r) => r.user) : [];
  const seen = seenBy.length > 0;
  const seenText = !seen ? 'Sent, not seen yet' : dm ? 'Seen' : `Seen by ${seenBy.length} of ${others.length}: ${seenBy.map((id) => users[id]?.name || 'someone').join(', ')}`;
  const groups = EMOJI.map((emoji) => ({ emoji, by: m.reactions.filter((r) => r.emoji === emoji).map((r) => r.user) })).filter((g) => g.by.length);
  const react = (emoji) => { setMode(null); dispatch(reactionToggled({ id: m.id, emoji })); };
  const reply = () => { setMode(null); dispatch(replyStarted({ id: m.id, fromName: mine ? 'yourself' : m.fromName, text: plain(m.text) })); };
  const copy = () => { setMode(null); navigator.clipboard?.writeText(m.text); };
  const toggle = (name) => setMode(mode === name ? null : name);

  // While editing, the message is replaced by a wide box to type in.
  if (mode === 'edit') return <div className="msg mine editing" id={`m-${m.id}`}><EditBox m={m} onDone={() => setMode(null)} /></div>;

  return (
    <div className={`msg ${mine ? 'mine' : ''}`} id={`m-${m.id}`}>
      {!mine && <Avatar user={users[m.from] || { name: m.fromName }} size="sm" />}
      <div className="msg-body">
        <div className="bubble">
          {!dm && !mine && <b className="from">{m.fromName}{users[m.from]?.title?.startsWith('Client') && <> <span className="loz client">Client</span></>}</b>}
          {m.replyTo && (m.replyTo.deleted
            ? <span className="quote gone">The original message was deleted</span>
            : <button className="quote" onClick={() => showMessage(m.replyTo.id)} title="Show the original message"><b>{m.replyTo.fromName}</b><span>{plain(m.replyTo.text)}</span></button>)}
          <div className="rich"><Rich text={m.text} names={channel.members.map((id) => users[id]?.name).filter(Boolean)} me={me.name} /></div>
          <small>
            <Time at={m.at} />{m.editedAt && ' · edited'}
            {mine && <span className={`ticks ${seen ? 'seen' : ''}`} title={seenText} aria-label={seenText}>{seen ? '✓✓' : '✓'}</span>}
          </small>
        </div>
        {groups.length > 0 && (
          <div className="reactions">
            {groups.map((g) => (
              <button key={g.emoji} className={`reaction ${g.by.includes(me.id) ? 'on' : ''}`} onClick={() => react(g.emoji)}
                title={`${g.by.map((id) => (id === me.id ? 'You' : users[id]?.name || 'Someone')).join(', ')} reacted with ${g.emoji}`}>{g.emoji} {g.by.length}</button>
            ))}
          </div>
        )}
        {mode === 'delete' && (
          <div className="confirm">
            <span>Delete this message? It will be removed for everyone.</span>
            <button className="btn danger" onClick={() => dispatch(messageDeleted(m.id))}>Delete</button>
            <button className="btn" onClick={() => setMode(null)}>Cancel</button>
          </div>
        )}
      </div>

      {/* The toolbar: quick reactions, more reactions, reply, and a menu of other actions. */}
      <div className={`msg-tools ${mode === 'react' || mode === 'more' ? 'open' : ''}`} role="toolbar" aria-label="Message actions">
        {QUICK_EMOJI.map((emoji) => <button key={emoji} className="tool emoji" onClick={() => react(emoji)} title={`React with ${emoji}`} aria-label={`React with ${emoji}`}>{emoji}</button>)}
        <button className="tool" onClick={() => toggle('react')} title="More reactions" aria-label="More reactions" aria-expanded={mode === 'react'}><Icon name="smile" /></button>
        <span className="tool-sep" />
        <button className="tool" onClick={reply} title="Reply to this message" aria-label="Reply to this message"><Icon name="quote" /></button>
        <button className="tool" onClick={() => toggle('more')} title="More actions" aria-label="More actions" aria-expanded={mode === 'more'}><Icon name="dots" /></button>
        {mode === 'react' && <div className="tool-pop emoji-picker" role="menu">{EMOJI.map((emoji) => <button key={emoji} onClick={() => react(emoji)} aria-label={`React with ${emoji}`}>{emoji}</button>)}</div>}
        {mode === 'more' && (
          <div className="tool-pop tool-menu" role="menu">
            <button role="menuitem" onClick={reply}>Reply</button>
            <button role="menuitem" onClick={copy}>Copy text</button>
            {mine && <button role="menuitem" onClick={() => setMode('edit')}>Edit</button>}
            {mine && <button role="menuitem" className="danger-item" onClick={() => setMode('delete')}>Delete</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// The "…" menu in a conversation's header: mute, hide and delete.
// Mute and hide affect only you. Deleting a direct message clears it on your side only;
// deleting a channel removes it for everyone and is offered only to the person who created it.
function ConversationMenu({ channel, title }) {
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dm = channel.kind === 'dm';
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  const run = async (mutation, variables, success, leave) => {
    setOpen(false);
    setConfirming(false);
    const done = await ask(dispatch, changeRequested({ mutation, variables, success }));
    if (!done) return;
    emit('changed', 'chat'); // the sidebar lists conversations too
    if (leave) navigate('#/for-you'); else dispatch(refreshRequested());
  };
  const id = channel.id;

  return (
    <div className="conv-menu">
      {channel.muted && <span className="loz" title="You get no notifications for this conversation">Muted</span>}
      {channel.hidden && <span className="loz" title="It is hidden from your sidebar">Hidden</span>}
      <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} title="Conversation options" aria-label="Conversation options" aria-expanded={open}><Icon name="dots" /></button>
      {open && (
        <div className="tool-pop tool-menu" role="menu">
          {channel.muted
            ? <button role="menuitem" onClick={() => run(MUTE, { channel: id, muted: false }, 'Unmuted. You will be notified about new messages again.')}><Icon name="unmute" />Unmute</button>
            : <button role="menuitem" onClick={() => run(MUTE, { channel: id, muted: true }, 'Muted. You will not be notified about new messages here.')}><Icon name="mute" />Mute</button>}
          {channel.hidden
            ? <button role="menuitem" onClick={() => run(HIDE, { channel: id, hidden: false }, 'It is back in your sidebar.')}><Icon name="show" />Show in sidebar</button>
            : <button role="menuitem" onClick={() => run(HIDE, { channel: id, hidden: true }, 'Hidden. It comes back when someone writes in it.', true)}><Icon name="hide" />Hide</button>}
          {channel.canDelete && <button role="menuitem" className="danger-item" onClick={() => setConfirming(true)}><Icon name="trash" />{dm ? 'Delete chat' : 'Delete channel'}</button>}
        </div>
      )}
      {confirming && (
        <Modal onClose={() => setConfirming(false)}>
          <div className="dialog">
            <header><h2>{dm ? `Delete your chat with ${title}?` : `Delete #${title}?`}</h2><CloseButton onClose={() => setConfirming(false)} /></header>
            <p>{dm
              ? `Every message so far is removed from your side and the chat leaves your list. ${title} keeps their copy. If either of you writes again, the chat starts fresh for you.`
              : 'The channel and all its messages are deleted for everyone in it. This cannot be undone.'}</p>
            <footer>
              <button className="btn subtle" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="btn danger" onClick={() => run(DELETE_CONVERSATION, { channel: id }, dm ? 'Chat deleted on your side.' : 'Channel deleted.', true)}>{dm ? 'Delete chat' : 'Delete channel'}</button>
            </footer>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Conversation({ channelId }) {
  const users = useUsers();
  const me = session.get()?.user;
  const dispatch = useDispatch();
  const { id, channel, messages, error, replyingTo } = useSelector((state) => state.chat);
  const box = useRef();

  useEffect(() => {
    dispatch(opened(channelId)); // the saga loads it and marks it read
    return () => { dispatch(closed(channelId)); }; // leaving the page: it is no longer being read
  }, [dispatch, channelId]);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight; // keep the newest message in view
  }, [messages, channel]);
  if (error) return <div className="dm"><div className="empty"><p><b>{error}</b></p></div></div>;
  if (!channel || id !== channelId) return <div className="dm"><div className="empty"><p className="muted">Loading…</p></div></div>;
  const dm = channel.kind === 'dm';
  const other = users[channel.other];
  const title = dm ? other?.name || '…' : channel.name;
  // Under your latest message: whether it has been seen.
  const lastMine = messages.at(-1)?.from === me.id ? messages.at(-1) : null;
  const sawLast = lastMine ? channel.reads.filter((r) => r.user !== me.id && r.at >= lastMine.at) : [];
  const seenLine = !sawLast.length ? 'Sent' : dm ? 'Seen' : `Seen by ${sawLast.length} of ${channel.members.length - 1}`;

  return (
    <div className="dm">
      <div className="dm-head">
        {dm ? <Avatar user={other} /> : <span className="hash big">{channel.private ? <Icon name="lock" /> : '#'}</span>}
        <span className="grow"><b>{title}</b><small>{dm ? other?.title : `${channel.private ? 'Private · ' : ''}${channel.members.length} members${channel.about ? ` · ${channel.about}` : ''}`}</small></span>
        {!dm && <span className="avs">{channel.members.map((id) => <span className="av-btn" key={id}><Avatar user={users[id]} size="sm" /></span>)}</span>}
        <ConversationMenu channel={channel} title={title} />
      </div>
      <div className="dm-thread" ref={box}>
        {messages.map((m) => <MessageRow key={m.id} m={m} channel={channel} users={users} me={me} />)}
        {lastMine && <p className="seen-line">{seenLine}</p>}
        {!messages.length && <p className="dm-empty">{dm ? `This is the start of your conversation with ${firstName(other)}.` : `This is the start of #${channel.name}.`}</p>}
      </div>
      {replyingTo && (
        <div className="reply-bar">
          <Icon name="quote" />
          <span className="grow clip"><b>Replying to {replyingTo.fromName}</b> {replyingTo.text}</span>
          <button className="icon-btn" onClick={() => dispatch(replyCancelled())} title="Cancel reply" aria-label="Cancel reply"><Icon name="x" /></button>
        </div>
      )}
      <Composer
        placeholder={`Message ${dm ? firstName(other) : `#${channel.name}`}`}
        people={channel.members.filter((id) => id !== me.id).map((id) => users[id]).filter(Boolean)}
        onSend={(text) => dispatch(messageSent(text))}
        onEscape={() => replyingTo && dispatch(replyCancelled())}
        focusKey={`${channel.id}:${replyingTo?.id || ''}`} /* focus the box when the conversation opens or a reply starts */
      />
    </div>
  );
}

function NewChannel({ projectKey }) {
  const users = useUsers();
  const me = session.get()?.user;
  const dispatch = useDispatch();
  const members = useSelector((state) => state.chat.members);
  const close = () => window.history.back();
  useEffect(() => { dispatch(membersRequested(projectKey)); }, [dispatch, projectKey]);
  const submit = async (e) => {
    e.preventDefault();
    const data = fields(e.target);
    const chosen = (members || []).map((m) => m.user).filter((id) => id !== me.id && `m_${id}` in data);
    const input = { project: projectKey, name: data.name, about: data.about, private: 'private' in data, members: chosen };
    const created = await ask(dispatch, changeRequested({ mutation: CREATE_CHANNEL, variables: { input }, success: 'Channel created.' }));
    if (created) { emit('changed', 'chat'); navigate(`#/p/${projectKey}/chat/${created.createChannel.id}`); }
  };
  return (
    <Modal onClose={close}>
      <form className="dialog" onSubmit={submit}>
        <header><h2>Create a channel</h2><CloseButton onClose={close} /></header>
        <p className="muted">A channel is a group conversation. Everyone you add can read and write in it.</p>
        <label>Channel name <span className="req">*</span><input name="name" required autoComplete="off" maxLength={30} autoFocus placeholder="For example: release-updates" /></label>
        <label>What is it for?<input name="about" autoComplete="off" placeholder="Optional" /></label>
        <label className="check"><input type="checkbox" name="private" /><Icon name="lock" /><span>Make private — people who join the space later are not added</span></label>
        <p className="label">Members</p>
        <div className="checks">
          {(members || []).map((m) => (
            <label className="check" key={m.user}>
              <input type="checkbox" name={`m_${m.user}`} defaultChecked disabled={m.user === me.id} /><Avatar user={users[m.user]} size="sm" />
              <span>{users[m.user]?.name}{m.user === me.id ? ' (you)' : ''}</span>{m.role === 'Client' ? <span className="loz client">Client</span> : <small>{users[m.user]?.title}</small>}
            </label>
          ))}
        </div>
        <footer><button type="button" className="btn subtle" onClick={close}>Cancel</button><button className="btn primary">Create</button></footer>
      </form>
    </Modal>
  );
}

function NewDm() {
  const users = useUsers();
  const me = session.get()?.user;
  const dispatch = useDispatch();
  const close = () => window.history.back();
  const start = async (user) => {
    const found = await ask(dispatch, changeRequested({ mutation: OPEN_DM, variables: { user } }));
    if (found) navigate(`#/dm/${found.openDirectMessage.id}`);
  };
  const others = Object.values(users).filter((u) => u.id !== me.id);
  return (
    <Modal onClose={close}>
      <div className="dialog">
        <header><h2>New message</h2><CloseButton onClose={close} /></header>
        <p className="muted">Choose who you want to message.</p>
        <div className="plist">
          {others.map((u) => <button className="pitem" key={u.id} onClick={() => start(u.id)}><Avatar user={u} /><span className="grow"><b>{u.name}</b><small>{u.title}</small></span></button>)}
          {!others.length && <p className="muted">Nobody else has an account yet.</p>}
        </div>
      </div>
    </Modal>
  );
}

export function App({ projectKey, channelId }) {
  return (
    <section className="page wide chat-page">
      {channelId === 'new-channel' ? <NewChannel projectKey={projectKey} />
        : channelId === 'new-dm' ? <NewDm />
        : channelId ? <Conversation channelId={channelId} key={channelId} />
        : <div className="dm"><div className="empty"><p><b>Select a conversation</b><br />Choose a channel or a person in the sidebar.</p></div></div>}
    </section>
  );
}

export const mount = createRemote(App, store);
