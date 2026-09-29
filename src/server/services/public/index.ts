import "server-only";
import { db } from "@/server/db/client";
import { createPublicCatalogueService } from "./public-catalogue.service";

export const publicCatalogue = createPublicCatalogueService(db);
