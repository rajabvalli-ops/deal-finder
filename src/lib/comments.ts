/** The name shown on a comment: the author's first name only, or "Member". */
export function commenterName(name: string): string {
  const first = /\S+/.exec(name)?.[0];
  return first ? first.slice(0, 30) : "Member";
}
