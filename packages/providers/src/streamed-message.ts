type DecodedString = { text: string; end: number; complete: boolean };

function decodedString(input: string, start: number): DecodedString | null {
  if (input[start] !== '"') return null;
  let text = "";
  for (let index = start + 1; index < input.length; index++) {
    const character = input[index];
    if (character === '"') return { text, end: index + 1, complete: true };
    if (character === "\\") {
      const escapedCharacter = input[++index];
      if (escapedCharacter === undefined) break;
      if (escapedCharacter === "u") {
        const hex = input.slice(index + 1, index + 5);
        if (!/^[\da-f]*$/i.test(hex)) return null;
        if (hex.length < 4) break;
        text += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
      } else {
        const escapes: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        const decoded = escapes[escapedCharacter];
        if (decoded === undefined) return null;
        text += decoded;
      }
    } else {
      if (character === undefined || character.charCodeAt(0) < 32) return null;
      text += character;
    }
  }
  // Do not display half of a Unicode surrogate pair while its next escape is pending.
  const last = text.charCodeAt(text.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1);
  return { text, end: input.length, complete: false };
}

function skipSpace(input: string, start: number): number {
  let index = start;
  while (/\s/.test(input[index] ?? "") && index < input.length) index++;
  return index;
}

function valueEnd(input: string, start: number): number | null {
  let depth = 0;
  for (let index = start; index < input.length; index++) {
    const character = input[index];
    if (character === '"') {
      const quoted = decodedString(input, index);
      if (!quoted?.complete) return null;
      index = quoted.end - 1;
      continue;
    }
    if (character === "{" || character === "[") depth++;
    else if (character === "}" || character === "]") {
      if (depth === 0) return index;
      depth--;
      if (depth === 0) return index + 1;
    } else if (character === "," && depth === 0) return index;
  }
  return null;
}

/** Decode only a top-level message string. Incomplete escapes wait for the next chunk. */
export function partialAssistantMessage(input: string): string | null {
  let index = skipSpace(input, 0);
  if (input[index++] !== "{") return null;
  while (index < input.length) {
    index = skipSpace(input, index);
    const key = decodedString(input, index);
    if (!key?.complete) return null;
    index = skipSpace(input, key.end);
    if (input[index++] !== ":") return null;
    index = skipSpace(input, index);
    if (key.text === "message") return decodedString(input, index)?.text ?? null;
    const end = valueEnd(input, index);
    if (end === null) return null;
    try {
      JSON.parse(input.slice(index, end));
    } catch {
      return null;
    }
    index = skipSpace(input, end);
    if (input[index++] !== ",") return null;
  }
  return null;
}
