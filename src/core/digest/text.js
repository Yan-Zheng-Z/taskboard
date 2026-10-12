// Turns a raw user message into the short plain text the digest keeps.

// Blocks that the agent tools insert into user turns. None of it was typed by the user.
const INSERTED_BLOCKS = [
  'system-reminder', 'local-command-caveat', 'local-command-stdout', 'local-command-stderr',
  'command-name', 'command-message', 'command-args', 'task-notification',
  'bash-input', 'bash-stdout', 'bash-stderr', 'user-prompt-submit-hook',
];
const INSERTED_RE = new RegExp(`<(${INSERTED_BLOCKS.join('|')})>[\\s\\S]*?</\\1>`, 'g');
// Whole messages that are status lines rather than something the user said.
const NOT_FROM_USER_RE = /^\[(SYSTEM NOTIFICATION|Request interrupted)/;

// Returns the cleaned text, or '' when nothing the user typed is left.
export function cleanMessage(raw, maxChars) {
  const text = raw.replace(INSERTED_RE, ' ').replace(/\s+/g, ' ').trim();
  if (text === '' || NOT_FROM_USER_RE.test(text)) return '';
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
