import { BN, Program, Wallet, web3 } from "@coral-xyz/anchor"

import { GameCore } from "../target/types/game_core"
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token"

const getInitializeInstructions = async (
  program: Program<GameCore>,
  publicKey?: web3.PublicKey
) => {
  const pubKey = publicKey || program.provider.publicKey

  const palaceAddress = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("palace"), pubKey.toBytes()],
    program.programId
  )[0]

  const playerAddress = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("player"), pubKey.toBytes()],
    program.programId
  )[0]

  // Add your test here.
  const ix = await program.methods.initialize().instruction()

  return { instructions: [ix], palaceAddress, playerAddress }
}

const getCreateTokenMintInstructions = async (program: Program<GameCore>) => {
  const mintAddress = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("mint")],
    program.programId
  )[0]

  const ix = await program.methods
    .createTokenMint()
    .accounts({
      mint: mintAddress,
    })
    .instruction()

  return { instructions: [ix], mintAddress }
}

const getCollectTokensInstructions = async (
  program: Program<GameCore>,
  publicKey?: web3.PublicKey
) => {
  const mint = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("mint")],
    program.programId
  )[0]

  const destination = publicKey
  const ata = await getAssociatedTokenAddress(mint, destination)
  const account = await program.provider.connection.getAccountInfo(ata)

  const ixs = []
  // create associated token account if it doesn't exist
  if (!account) {
    ixs.push(
      createAssociatedTokenAccountInstruction(
        program.provider.publicKey,
        ata,
        destination,
        mint
      )
    )
  }

  ixs.push(
    await program.methods
      .collectTokens()
      .accounts({
        mint,
        destinationAta: ata,
      })
      .instruction()
  )

  return { instructions: ixs, ata, account }
}

const getPurchaseMerchantItemInstructions = async (
  program: Program<GameCore>,
  publicKey: web3.PublicKey,
  item: string,
  amount: BN = new BN(1)
) => {
  const playerAddress = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("player"), program.provider.publicKey.toBytes()],
    program.programId
  )[0]

  const mint = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("mint")],
    program.programId
  )[0]

  const ata = await getAssociatedTokenAddress(mint, publicKey)

  // Purchase a lumberjack
  const ix = await program.methods
    .purchaseMerchantItem(item, amount)
    .accounts({ fromAta: ata })
    .instruction()

  return { instructions: [ix], playerAddress, ata }
}

export {
  getInitializeInstructions,
  getCreateTokenMintInstructions,
  getCollectTokensInstructions,
  getPurchaseMerchantItemInstructions,
}
