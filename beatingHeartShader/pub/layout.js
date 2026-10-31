export function asciiPoem(input) {
  const punctuation = { '‘': "'", '’': "'", '“': '"', '”': '"', '—': '-', '–': '-', '…': '...', ' ': ' ', 'œ': 'oe', 'Œ': 'OE', 'æ': 'ae', 'Æ': 'AE', 'ß': 'ss' };
  const plain = input.replace(/[‘’“”—–… œŒæÆß]/g, character => punctuation[character])
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\r\n?/g, '\n').replace(/\t/g, '  ')
    .replace(/[^\x0A\x20-\x7E]/g, '?');
  return plain.split('\n').map(line => line.trim().replace(/ {2,}/g, ' ')).join('\n').trim();
}

// The projected 3D mesh supplies cell occupancy. Text flows through its cells
// in reading order. Wide rows wrap at word boundaries when possible, while
// narrow vessels still receive letters so the anatomical outline stays intact.
export function layoutText(poem, rowSlots, columns) {
  const normalized = asciiPoem(poem);
  const rows = rowSlots.length;
  if (!normalized) return { pages: [new Uint32Array(columns * rows)], normalized, placed: 0 };
  const sequence = normalized.replace(/\s+/g, ' ');
  const stream = sequence + ' ';
  const capacity = rowSlots.reduce((total, slots) => total + slots.length, 0);
  if (capacity === 0) throw new Error('The heart is too small for text at this size. Enlarge the window or choose smaller text.');
  const widestRow = Math.max(...rowSlots.map(slots => slots.length));
  const pages = [];
  let cursor = 0;
  let placed = 0;
  let firstPassComplete = false;
  while (!firstPassComplete && pages.length < 100) {
    const page = new Uint32Array(columns * rows);
    for (let row = 0; row < rows; row++) {
      const slots = rowSlots[row];
      for (let index = 0; index < slots.length; index++) {
        if (index === 0 && stream[cursor] === ' ') cursor = (cursor + 1) % stream.length;
        if (slots.length >= 14 && stream[cursor] !== ' ' && (cursor === 0 || stream[cursor - 1] === ' ')) {
          const nextSpace = stream.indexOf(' ', cursor);
          const wordLength = nextSpace - cursor;
          if (wordLength > slots.length - index && wordLength <= widestRow) break;
        }
        const code = stream.charCodeAt(cursor);
        page[row * columns + slots[index]] = code;
        if (code !== 32) placed++;
        cursor++;
        if (cursor === sequence.length) firstPassComplete = true;
        if (cursor === stream.length) cursor = 0;
      }
    }
    pages.push(page);
  }
  if (!firstPassComplete) throw new Error('The poem needs more than 100 pages at this text size. Choose smaller text or shorten it.');
  return { pages, normalized, placed };
}
