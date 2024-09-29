-- CreateTable
CREATE TABLE "Position" (
    "id" SERIAL NOT NULL,
    "walletId" INTEGER NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "amount" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
