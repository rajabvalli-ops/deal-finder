import type { Prisma } from "@/generated/prisma/client";
import type { ImportJobType, ImportRunStatus } from "@/generated/prisma/enums";
import type { DbClient } from "../types";

export type ImportRunProgress = {
  cursor: string | null;
  itemsSeen: number;
  itemsUpserted: number;
  itemsFailed: number;
  errorSample: Prisma.InputJsonValue | null;
};

export function createImportRunRepository(client: DbClient) {
  return {
    start(retailerId: string, jobType: ImportJobType, startedAt: Date) {
      return client.importRun.create({
        data: { retailerId, jobType, startedAt, status: "RUNNING" },
      });
    },

    saveProgress(id: string, progress: ImportRunProgress) {
      return client.importRun.update({ where: { id }, data: toData(progress) });
    },

    finish(
      id: string,
      status: Exclude<ImportRunStatus, "RUNNING">,
      progress: ImportRunProgress,
      finishedAt: Date,
    ) {
      return client.importRun.update({
        where: { id },
        data: { ...toData(progress), status, finishedAt },
      });
    },

    findById(id: string) {
      return client.importRun.findUnique({ where: { id } });
    },
  };
}

function toData(progress: ImportRunProgress) {
  const { errorSample, ...rest } = progress;
  return { ...rest, errorSample: errorSample ?? undefined };
}

export type ImportRunRepository = ReturnType<typeof createImportRunRepository>;
