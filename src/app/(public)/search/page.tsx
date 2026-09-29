import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/ui/page-placeholder";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <PagePlaceholder
      title="Search"
      description="Search products and deals by keyword, category, retailer and price."
    />
  );
}
