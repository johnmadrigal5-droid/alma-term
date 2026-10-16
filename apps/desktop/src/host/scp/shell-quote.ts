/**
 * One argument for a POSIX shell: inside single quotes nothing is special, and a quote itself
 * is closed, escaped and reopened. A NUL cannot travel in a command line at all.
 */
export function shellQuote(text: string): string {
  if (text.includes('\0')) throw new Error('Un argumento de shell no puede contener NUL')
  return `'${text.replaceAll("'", `'\\''`)}'`
}
