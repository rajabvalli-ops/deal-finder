import { getCurrentUser, hasRole } from "@/server/auth";
import { adminReads } from "@/server/services/admin";
import { ActionMessages } from "../_lib/messages";
import { param, type SearchParams } from "../_lib/params";
import { createCategory, updateCategory } from "./actions";

export const metadata = { title: "Categories" };

const field = "rounded-md border border-line bg-surface px-2 py-1";

export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [sp, user, categories] = await Promise.all([
    searchParams,
    getCurrentUser(),
    adminReads.listCategories(),
  ]);
  const canEdit = user !== null && hasRole(user.role, "ADMIN");
  const topLevel = categories.filter((c) => c.parentId === null);
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id);
  const ordered = topLevel.flatMap((c) => [
    { ...c, depth: 0 },
    ...childrenOf(c.id).map((ch) => ({ ...ch, depth: 1 })),
  ]);
  // Anything deeper than two levels is still listed, just not indented.
  const listed = new Set(ordered.map((c) => c.id));
  const rows = [
    ...ordered,
    ...categories.filter((c) => !listed.has(c.id)).map((c) => ({ ...c, depth: 1 })),
  ];

  const parentOptions = (excludeId?: string) => (
    <>
      <option value="">— Top level —</option>
      {topLevel
        .filter((c) => c.id !== excludeId)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
    </>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Categories</h1>
      <ActionMessages notice={param(sp, "notice")} error={param(sp, "error")} />

      <table className="w-full text-left text-sm">
        <thead className="text-ink-muted">
          <tr>
            <th className="py-2 pr-4 font-medium">Category</th>
            <th className="py-2 pr-4 font-medium">Slug</th>
            <th className="py-2 pr-4 text-right font-medium">Products</th>
            {canEdit ? <th className="py-2 pr-4 font-medium">Edit</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-line">
              <td className={`py-2 pr-4 ${c.depth ? "pl-6" : "font-medium"}`}>{c.name}</td>
              <td className="py-2 pr-4">
                <code className="text-xs">{c.slug}</code>
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{c._count.products}</td>
              {canEdit ? (
                <td className="py-2 pr-4">
                  <form action={updateCategory} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="categoryId" value={c.id} />
                    <input
                      name="name"
                      defaultValue={c.name}
                      required
                      minLength={2}
                      maxLength={80}
                      aria-label={`Name for ${c.name}`}
                      className={field}
                    />
                    <select
                      name="parentId"
                      defaultValue={c.parentId ?? ""}
                      aria-label={`Parent of ${c.name}`}
                      className={field}
                    >
                      {parentOptions(c.id)}
                    </select>
                    <input
                      name="sortOrder"
                      type="number"
                      min={0}
                      max={1000}
                      defaultValue={c.sortOrder}
                      aria-label={`Order of ${c.name}`}
                      className={`${field} w-20`}
                    />
                    <button
                      type="submit"
                      className="rounded-md border border-line px-3 py-1 font-medium hover:border-brand-600"
                    >
                      Save
                    </button>
                  </form>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {canEdit ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Add a category</h2>
          <form action={createCategory} className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col">
              Name
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="flex flex-col">
              Parent
              <select name="parentId" className={`mt-1 ${field}`}>
                {parentOptions()}
              </select>
            </label>
            <label className="flex flex-col">
              Order
              <input
                name="sortOrder"
                type="number"
                min={0}
                max={1000}
                defaultValue={0}
                className={`mt-1 ${field} w-20`}
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
            >
              Add category
            </button>
          </form>
          <p className="text-xs text-ink-muted">
            The URL slug is set from the name when created and doesn&apos;t change on rename.
          </p>
        </section>
      ) : (
        <p className="text-sm text-ink-muted">Only admins can change categories.</p>
      )}
    </div>
  );
}
