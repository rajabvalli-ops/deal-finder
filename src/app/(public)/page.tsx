import { PagePlaceholder } from "@/components/ui/page-placeholder";
import { site } from "@/lib/site";

export default function HomePage() {
  return <PagePlaceholder title={site.name} description={site.tagline} />;
}
