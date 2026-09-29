import { notFound } from "next/navigation";

// No deals exist until the database stage, so every slug is a 404 rather than fake content.
export default function DealPage(): never {
  notFound();
}
