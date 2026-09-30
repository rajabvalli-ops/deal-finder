/** Converts text into a lowercase, hyphenated, ASCII-only URL segment. */
export function slugify(text: string, maxLength = 80): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/£/g, " gbp ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, maxLength).replace(/-+$/, "");
}
