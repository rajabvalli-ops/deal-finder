import "dotenv/config";

/**
 * Returns TEST_DATABASE_URL, refusing anything whose database name doesn't contain "test".
 * The suite truncates every table, so pointing it at a real database must be impossible.
 */
export function assertTestDatabase(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set to run integration tests");
  const name = new URL(url).pathname.slice(1);
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run integration tests against "${name}": name must contain "test"`,
    );
  }
  return url;
}
