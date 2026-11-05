import "server-only";
import { db } from "@/server/db/client";
import { createPublicCatalogueService } from "./public-catalogue.service";
import { createSearchService } from "./search.service";

export const publicCatalogue = createPublicCatalogueService(db);
export const publicSearch = createSearchService(db);
