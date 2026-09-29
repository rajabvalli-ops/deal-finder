import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/ui/page-placeholder";

export const metadata: Metadata = { title: "Latest deals" };

export default function DealsPage() {
  return (
    <PagePlaceholder
      title="Latest deals"
      description="Price drops from UK retailers, reviewed before they are published."
    />
  );
}
