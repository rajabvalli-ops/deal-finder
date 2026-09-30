import { Pagination } from "@/components/admin/pagination";
import { formatDate, humanise } from "@/lib/format";
import { pageRequest, toPage } from "@/lib/pagination";
import { requireRole, ROLES, type Role } from "@/server/auth";
import { adminReads } from "@/server/services/admin";
import { ActionMessages } from "../_lib/messages";
import { param, type SearchParams } from "../_lib/params";
import { setUserRole } from "./actions";

export const metadata = { title: "Users" };

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await requireRole("ADMIN", "/admin/users");
  const sp = await searchParams;
  const q = param(sp, "q");
  const roleParam = param(sp, "role");
  const role = (ROLES as readonly string[]).includes(roleParam ?? "")
    ? (roleParam as Role)
    : undefined;
  const request = pageRequest(sp.page);
  const { items, total } = await adminReads.listUsers({
    q,
    role,
    skip: request.skip,
    take: request.take,
  });
  const page = toPage(items, total, request);
  const returnTo = `/admin/users?${new URLSearchParams(Object.entries({ q, role }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Users</h1>
      <ActionMessages notice={param(sp, "notice")} error={param(sp, "error")} />
      <form className="flex flex-wrap items-end gap-3 text-sm" role="search">
        <label className="flex flex-col">
          Search
          <input
            name="q"
            defaultValue={q}
            placeholder="Email or name"
            className="mt-1 rounded-md border border-line bg-surface px-2 py-1"
          />
        </label>
        <label className="flex flex-col">
          Role
          <select
            name="role"
            defaultValue={role ?? ""}
            className="mt-1 rounded-md border border-line bg-surface px-2 py-1"
          >
            <option value="">All</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {humanise(r)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
        >
          Filter
        </button>
      </form>
      <p className="text-sm text-ink-muted">
        {total} user{total === 1 ? "" : "s"}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-ink-muted">
            <tr>
              <th className="py-2 pr-4 font-medium">Email</th>
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Joined</th>
              <th className="py-2 pr-4 font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="py-2 pr-4">{u.email}</td>
                <td className="py-2 pr-4">{u.name || "—"}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{formatDate(u.createdAt)}</td>
                <td className="py-2 pr-4">
                  {u.id === me.id ? (
                    <span>{humanise(u.role)} (you)</span>
                  ) : (
                    <form action={setUserRole} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <select
                        name="role"
                        defaultValue={u.role}
                        aria-label={`Role for ${u.email}`}
                        className="rounded-md border border-line bg-surface px-2 py-1"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {humanise(r)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-3 py-1 font-medium hover:border-brand-600"
                      >
                        Save
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        basePath="/admin/users"
        params={{ q, role }}
        page={page.page}
        pageCount={page.pageCount}
      />
    </div>
  );
}
