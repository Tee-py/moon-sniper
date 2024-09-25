-- CreateTable
CREATE TABLE "Wallet" (
    "id" SERIAL NOT NULL,
    "chatId" INTEGER NOT NULL,
    "walletJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_chatId_key" ON "Wallet"("chatId");
