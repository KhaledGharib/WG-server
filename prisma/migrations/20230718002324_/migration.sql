/*
  Warnings:

  - You are about to alter the column `ipAddress` on the `display` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(45)`.

*/
-- AlterTable
ALTER TABLE "display" ALTER COLUMN "ipAddress" SET DATA TYPE VARCHAR(45);
