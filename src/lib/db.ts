import { PrismaClient } from "@/generated/prisma";

// Reuse one PrismaClient across hot-reloads in dev (avoids exhausting connections).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
