// The message box: formatting buttons on top, the text in the middle, and
// "Aa", emoji, @mention and send along the bottom.
// Enter sends, Shift+Enter starts a new line, Ctrl+B / Ctrl+I / Ctrl+U format the selection.
import React, { useEffect, useRef, useState } from 'react';
import { Avatar, Icon } from '@scrumwise/ui';

export const TYPING_EMOJI = ['😀', '😂', '😊', '😍', '😮', '😢', '👍', '🙏', '🎉', '❤️', '🔥', '✅'];

export function Composer({ placeholder, people, onSend, onEscape, focusKey }) {
  const [text, setText] = useState('');
  const [formatting, setFormatting] = useState(true);
  const [pop, setPop] = useState(null); // 'emoji' or 'mention'
  const area = useRef();

  useEffect(() => { area.current?.focus(); }, [focusKey]);
  useEffect(() => { // the box grows with the text, up to a limit
    area.current.style.height = 'auto';
    area.current.style.height = `${Math.min(area.current.scrollHeight, 220)}px`;
  }, [text]);

  // Replaces the text and puts the cursor (or a selection) where the person expects to keep typing.
  const apply = (next, start, end = start) => {
    setText(next);
    setTimeout(() => { area.current.focus(); area.current.setSelectionRange(start, end); });
  };
  const selection = () => [area.current.selectionStart, area.current.selectionEnd];

  // Bold, italic and the like: put marks around the selection (or around a placeholder word).
  const wrap = (before, after = before, fallback = 'text') => {
    const [a, b] = selection();
    const chosen = text.slice(a, b) || fallback;
    apply(text.slice(0, a) + before + chosen + after + text.slice(b), a + before.length, a + before.length + chosen.length);
  };
  // Lists and quotes: put a mark at the start of every selected line.
  const prefix = (mark) => {
    const [a, b] = selection();
    const start = text.lastIndexOf('\n', a - 1) + 1;
    const stop = text.indexOf('\n', b) === -1 ? text.length : text.indexOf('\n', b);
    const marked = text.slice(start, stop).split('\n').map((line, n) => mark(n) + line).join('\n');
    apply(text.slice(0, start) + marked + text.slice(stop), start + marked.length);
  };
  const codeBlock = () => {
    const [a, b] = selection();
    const chosen = text.slice(a, b) || 'code';
    const before = `${a > 0 && text[a - 1] !== '\n' ? '\n' : ''}\`\`\`\n`;
    apply(`${text.slice(0, a)}${before}${chosen}\n\`\`\`\n${text.slice(b)}`, a + before.length, a + before.length + chosen.length);
  };
  const link = () => {
    const [a, b] = selection();
    const label = text.slice(a, b) || 'link text';
    const at = a + label.length + 3; // just inside the brackets for the address
    apply(`${text.slice(0, a)}[${label}](https://)${text.slice(b)}`, at, at + 'https://'.length);
  };
  const insert = (piece) => {
    const [a, b] = selection();
    setPop(null);
    apply(text.slice(0, a) + piece + text.slice(b), a + piece.length);
  };

  const send = () => {
    const ready = text.trim();
    if (!ready) return;
    onSend(ready);
    setText('');
    setPop(null);
    area.current.focus();
  };
  const keys = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    else if (e.key === 'Escape') { if (pop) setPop(null); else onEscape?.(); }
    else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**'); }
    else if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('_'); }
    else if (mod && e.key.toLowerCase() === 'u') { e.preventDefault(); wrap('__'); }
  };

  const FORMAT = [
    ['Bold (Ctrl+B)', <b key="b">B</b>, () => wrap('**')],
    ['Italic (Ctrl+I)', <i key="i">I</i>, () => wrap('_')],
    ['Underline (Ctrl+U)', <u key="u">U</u>, () => wrap('__')],
    ['Strikethrough', <s key="s">S</s>, () => wrap('~~')],
    null,
    ['Link', <Icon key="l" name="link" />, link],
    ['Numbered list', <Icon key="o" name="ol" />, () => prefix((n) => `${n + 1}. `)],
    ['Bulleted list', <Icon key="u" name="ul" />, () => prefix(() => '- ')],
    null,
    ['Quote', <Icon key="q" name="blockquote" />, () => prefix(() => '> ')],
    ['Code', <Icon key="c" name="code" />, () => wrap('`', '`', 'code')],
    ['Code block', <Icon key="k" name="codeblock" />, codeBlock],
  ];

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
      {formatting && (
        <div className="composer-format" role="toolbar" aria-label="Formatting">
          {FORMAT.map((tool, n) => (tool
            ? <button type="button" key={tool[0]} className="tool" title={tool[0]} aria-label={tool[0]} onMouseDown={(e) => e.preventDefault()} onClick={tool[2]}>{tool[1]}</button>
            : <span key={n} className="tool-sep" />))}
        </div>
      )}
      <textarea ref={area} rows={1} value={text} placeholder={placeholder} aria-label="Write a message" onChange={(e) => setText(e.target.value)} onKeyDown={keys} />
      <div className="composer-bar">
        <button type="button" className={`tool ${formatting ? 'on' : ''}`} onClick={() => setFormatting(!formatting)} title={formatting ? 'Hide formatting' : 'Show formatting'} aria-pressed={formatting}><span className="aa">Aa</span></button>
        <button type="button" className="tool" onClick={() => setPop(pop === 'emoji' ? null : 'emoji')} title="Add an emoji" aria-label="Add an emoji" aria-expanded={pop === 'emoji'}><Icon name="smile" /></button>
        <button type="button" className="tool" onClick={() => setPop(pop === 'mention' ? null : 'mention')} title="Mention someone" aria-label="Mention someone" aria-expanded={pop === 'mention'}><Icon name="at" /></button>
        <span className="spacer" />
        <span className="composer-hint"><b>Shift+Enter</b> for a new line</span>
        <button className="composer-send" disabled={!text.trim()} title="Send (Enter)" aria-label="Send message"><Icon name="send" /></button>
        {pop === 'emoji' && <div className="tool-pop emoji-grid" role="menu">{TYPING_EMOJI.map((emoji) => <button type="button" key={emoji} onClick={() => insert(emoji)} aria-label={`Insert ${emoji}`}>{emoji}</button>)}</div>}
        {pop === 'mention' && (
          <div className="tool-pop tool-menu mention-menu" role="menu">
            {people.map((p) => <button type="button" role="menuitem" key={p.id} onClick={() => insert(`@${p.name} `)}><Avatar user={p} size="sm" />{p.name}</button>)}
            {!people.length && <p className="muted">Nobody else is in this conversation.</p>}
          </div>
        )}
      </div>
    </form>
  );
}
