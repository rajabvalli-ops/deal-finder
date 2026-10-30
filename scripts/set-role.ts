// Grants a role to an existing account. The only way to create the first admin: roles can
// never be chosen at sign-up, and this needs direct database access.
//
//   npm run user:role -- someone@example.com ADMIN
import "dotenv/config";
import { db } from "@/server/db/client";
import { isRole, ROLES } from "@/server/auth/roles";

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || !role || !isRole(role)) {
    throw new Error(`Usage: npm run user:role -- <email> <${ROLES.join("|")}>`);
  }
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw new Error(`No account for ${email} — sign up first.`);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { role } }),
    db.auditLog.create({
      data: {
        actorId: null,
        action: "user.set-role",
        entityType: "User",
        entityId: user.id,
        diff: { from: user.role, to: role, via: "cli" },
      },
    }),
  ]);
  console.log(`${user.email}: ${user.role} → ${role}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
