import { notFound } from "next/navigation";

// No retailers exist until the database stage, so every slug is a 404 rather than fake content.
export default function RetailerPage(): never {
  notFound();
}
