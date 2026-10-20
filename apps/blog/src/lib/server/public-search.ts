/** ILIKE contains search. Literal chunks use indexOf; wildcards never form a regexp. */
export function publicSearch(text: string, query: string) {
  const value = text.toLocaleLowerCase();
  const chunks = query.toLocaleLowerCase().split(/[%*]+/).filter(Boolean);
  if (!query.includes("_")) {
    let offset = 0;
    for (const chunk of chunks) {
      const found = value.indexOf(chunk, offset);
      if (found < 0) return false;
      offset = found + chunk.length;
    }
    return true;
  }
  const characters = Array.from(value);
  let offset = 0;
  for (const chunk of chunks) {
    const pattern = Array.from(chunk);
    let found = false;
    for (; offset <= characters.length - pattern.length; offset++) {
      if (
        pattern.every(
          (char, index) => char === "_" || char === characters[offset + index],
        )
      ) {
        offset += pattern.length;
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}
