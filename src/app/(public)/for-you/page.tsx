import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { DealGrid } from "@/components/public/deal-card";
import { getCurrentUser } from "@/server/auth";
import { publicCatalogue } from "@/server/services/public";

export const metadata: Metadata = {
  title: "Deals for you",
  description: "Hot deals picked from the categories and shops you follow.",
  robots: { index: false, follow: true },
};

export default async function ForYouPage() {
  const user = await getCurrentUser();
  const header = (
    <>
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { href: "/deals", label: "Deals" },
          { label: "For you" },
        ]}
      />
      <h1 className="text-3xl font-bold">✨ Deals for you</h1>
    </>
  );

  if (!user) {
    return (
      <div className="space-y-6">
        {header}
        <p>
          <Link
            href="/sign-in?next=%2Ffor-you"
            className="font-medium text-brand-600 hover:underline"
          >
            Sign in
          </Link>{" "}
          and we&apos;ll pick deals from the categories and shops you&apos;re into, based on your
          alerts, votes and comments.
        </p>
      </div>
    );
  }

  const { personal, deals } = await publicCatalogue.forYou(user.id, new Date());
  return (
    <div className="space-y-6">
      {header}
      <p className="max-w-prose text-ink-muted">
        {personal ? (
          "Hot deals from the categories and shops you've set alerts for, voted on or commented on."
        ) : (
          <>
            Nothing to go on yet, so here&apos;s what&apos;s hot. Vote 🔥 on deals you like or{" "}
            <Link href="/alerts" className="font-medium text-brand-600 hover:underline">
              set an alert
            </Link>{" "}
            and this page fills with deals for you.
          </>
        )}
      </p>
      {deals.length > 0 ? (
        <DealGrid deals={deals} />
      ) : (
        <p className="text-ink-muted">No matching deals are live right now. Check back soon.</p>
      )}
    </div>
  );
}
