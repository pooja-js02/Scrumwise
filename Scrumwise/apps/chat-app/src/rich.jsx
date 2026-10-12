// Turns the text of a message into formatted content.
//
//   **bold**   _italic_   __underline__   ~~strike~~   `code`   [label](https://link)
//   > quote     - bullet     1. numbered     ``` code block ```
//
// Bare web addresses, issue keys (PAY-12) and @mentions of people in the conversation become links
// or highlights. Everything is built as React elements, never as raw HTML, so a message cannot
// inject markup into the page.
import React from 'react';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NEVER = '((?!))'; // a group that never matches, to keep the group numbers the same

function inline(text, names, me, key) {
  const mention = names.length ? `(@(?:${names.map(escape).join('|')}))` : NEVER;
  const pattern = new RegExp([
    '(`[^`\\n]+`)',                                        // 1 code
    '(\\*\\*[^*\\n]+\\*\\*)',                              // 2 bold
    '(__[^_\\n]+__)',                                      // 3 underline
    '(~~[^~\\n]+~~)',                                      // 4 strike
    '((?<![\\w])_[^_\\n]+_(?![\\w]))',                     // 5 italic (not inside snake_case words)
    '(\\[[^\\]\\n]+\\]\\(https?:\\/\\/[^\\s)]+\\))',       // 6 [label](link)
    '(https?:\\/\\/[^\\s<]*[^\\s<.,;:!?)])',               // 7 bare link
    '(\\b[A-Z]{2,5}-\\d+\\b)',                             // 8 issue key
    mention,                                               // 9 @Name
  ].join('|'), 'g');
  const out = [];
  let last = 0;
  let n = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const s = m[0];
    const k = `${key}.${n++}`;
    const inner = (cut) => inline(s.slice(cut, -cut), names, me, k);
    if (m[1]) out.push(<code key={k}>{s.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inner(2)}</strong>);
    else if (m[3]) out.push(<u key={k}>{inner(2)}</u>);
    else if (m[4]) out.push(<s key={k}>{inner(2)}</s>);
    else if (m[5]) out.push(<em key={k}>{inner(1)}</em>);
    else if (m[6]) { const [, label, url] = s.match(/^\[([^\]]+)\]\((.+)\)$/); out.push(<a key={k} className="link" href={url} target="_blank" rel="noopener noreferrer">{label}</a>); }
    else if (m[7]) out.push(<a key={k} className="link" href={s} target="_blank" rel="noopener noreferrer">{s}</a>);
    else if (m[8]) out.push(<a key={k} className="link issue-link" href={`#/p/${s.split('-')[0]}/board?issue=${s}`}>{s}</a>);
    else out.push(<span key={k} className={`mention ${s.slice(1) === me ? 'me' : ''}`}>{s}</span>);
    last = m.index + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const QUOTE = /^> ?/;
const BULLET = /^[-•] /;
const NUMBER = /^\d+\. /;
const special = (line) => line.startsWith('```') || QUOTE.test(line) || BULLET.test(line) || NUMBER.test(line);

export function Rich({ text, names = [], me }) {
  const lines = text.split('\n');
  const blocks = [];
  const take = (test) => { const got = []; while (i < lines.length && test(lines[i])) got.push(lines[i++]); return got; };
  let i = 0;
  while (i < lines.length) {
    const k = blocks.length;
    const line = lines[i];
    if (line.startsWith('```')) {
      let body;
      if (line.length > 6 && line.endsWith('```')) { body = [line.slice(3, -3)]; i++; } // all on one line
      else { i++; body = take((l) => !l.startsWith('```')); i++; }
      blocks.push(<pre key={k}><code>{body.join('\n')}</code></pre>);
    } else if (QUOTE.test(line)) {
      blocks.push(<blockquote key={k}>{inline(take((l) => QUOTE.test(l)).map((l) => l.replace(QUOTE, '')).join('\n'), names, me, k)}</blockquote>);
    } else if (BULLET.test(line)) {
      blocks.push(<ul key={k}>{take((l) => BULLET.test(l)).map((l, n) => <li key={n}>{inline(l.replace(BULLET, ''), names, me, `${k}.${n}`)}</li>)}</ul>);
    } else if (NUMBER.test(line)) {
      blocks.push(<ol key={k}>{take((l) => NUMBER.test(l)).map((l, n) => <li key={n}>{inline(l.replace(NUMBER, ''), names, me, `${k}.${n}`)}</li>)}</ol>);
    } else {
      blocks.push(<p key={k}>{inline(take((l) => !special(l)).join('\n'), names, me, k)}</p>);
    }
  }
  return blocks;
}

// The same text with the formatting marks removed, for one-line previews such as a quoted reply.
export const plain = (text) => text
  .replace(/```/g, '').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
  .replace(/(\*\*|__|~~|`)/g, '').replace(/(?<![\w])_([^_\n]+)_(?![\w])/g, '$1')
  .replace(/^(> ?|[-•] |\d+\. )/gm, '').replace(/\s*\n\s*/g, ' ').trim();
