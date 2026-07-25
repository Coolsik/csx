export function escapeTerminalText(value) {
  let result = "";
  for (const character of String(value ?? "")) {
    const codePoint = character.codePointAt(0);
    if (character === "\\") result += "\\\\";
    else if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      result += `\\x${codePoint.toString(16).toUpperCase().padStart(2, "0")}`;
    } else if (
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x2028 && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      result += `\\u${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
    } else result += character;
  }
  return result;
}
