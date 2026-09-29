import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/ui/page-placeholder";

export const metadata: Metadata = { title: "Price alerts" };

export default function AlertsPage() {
  return (
    <PagePlaceholder
      title="Price alerts"
      description="Get notified when a product drops below the price you want to pay."
    />
  );
}
