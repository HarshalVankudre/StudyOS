-- Recent editor save ids per workspace (lib/workspace/save-ids.ts). Additive
-- with a default, so code without save ids keeps working during a deploy.
ALTER TABLE "Workspace" ADD COLUMN "saveIds" TEXT NOT NULL DEFAULT '';
