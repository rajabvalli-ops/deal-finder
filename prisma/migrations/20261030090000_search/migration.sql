-- Stage 12: search. No table changes — functions and indexes Prisma can't express.

-- Trigram matching for typo-tolerant search. A trusted extension, so the database owner
-- can create it (PostgreSQL 13+); managed providers such as Neon include it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The weighted document products are searched by: title (A), brand and model (B),
-- description (C). One function so the index and the query always use the same expression.
CREATE OR REPLACE FUNCTION product_search_document(title text, brand text, model text, description text)
RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A')
      || setweight(to_tsvector('english'::regconfig, coalesce(brand, '') || ' ' || coalesce(model, '')), 'B')
      || setweight(to_tsvector('english'::regconfig, left(coalesce(description, ''), 2000)), 'C')
$$;

CREATE INDEX "Product_search_document_idx"
  ON "Product" USING GIN (product_search_document("title", "brand", "model", "description"));

-- Typo-tolerant title matching (word_similarity).
CREATE INDEX "Product_title_trgm_idx"
  ON "Product" USING GIN (lower("title") gin_trgm_ops);
