-- CreateTable
CREATE TABLE "model_prices" (
    "id" UUID NOT NULL,
    "model" VARCHAR(200) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "inputPerMTok" DECIMAL(12,6) NOT NULL,
    "outputPerMTok" DECIMAL(12,6) NOT NULL,
    "cacheReadPerMTok" DECIMAL(12,6),
    "cacheWritePerMTok" DECIMAL(12,6),
    "reasoningPerMTok" DECIMAL(12,6),
    "source" VARCHAR(500) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "model_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "model_prices_model_effectiveFrom_key" ON "model_prices"("model", "effectiveFrom");

-- Hand-written: Prisma schema cannot express CHECK constraints.
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_rates_nonnegative" CHECK (
  "inputPerMTok" >= 0 AND "outputPerMTok" >= 0
  AND ("cacheReadPerMTok" IS NULL OR "cacheReadPerMTok" >= 0)
  AND ("cacheWritePerMTok" IS NULL OR "cacheWritePerMTok" >= 0)
  AND ("reasoningPerMTok" IS NULL OR "reasoningPerMTok" >= 0)
);
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_model_not_blank" CHECK (length(btrim("model")) > 0);
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_source_not_blank" CHECK (length(btrim("source")) > 0);
