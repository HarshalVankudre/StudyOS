// src/lib/assets/repo.ts
import "server-only";
import { prisma } from "@/lib/db";

export interface AssetRow {
  id: string;
  ownerId: string;
  workspaceId?: string | null;
  mime: string;
  sizeBytes: number;
  storageKey: string;
  sourceRunId?: string | null;
  checksum?: string | null;
}

export interface AssetRepo {
  insert(row: AssetRow): Promise<void>;
  findById(id: string): Promise<AssetRow | null>;
}

export function prismaAssetRepo(): AssetRepo {
  return {
    async insert(row) {
      await prisma.asset.create({ data: row });
    },
    async findById(id) {
      return prisma.asset.findUnique({ where: { id } });
    },
  };
}
