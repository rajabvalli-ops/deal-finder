import { notFound } from "next/navigation";

// No categories exist until the database stage, so every slug is a 404 rather than fake content.
export default function CategoryPage(): never {
  notFound();
}
