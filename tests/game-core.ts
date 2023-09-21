import * as anchor from "@coral-xyz/anchor"
import { Program } from "@coral-xyz/anchor"
import { GameCore } from "../target/types/game_core"
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token"
import { expect } from "chai"

if (!process.env.ANCHOR_WALLET || process.env.ANCHOR_WALLET === "") {
  throw new Error("expected environment variable `ANCHOR_WALLET` is not set.")
}

const payer = anchor.web3.Keypair.fromSecretKey(
  Buffer.from(
    JSON.parse(
      require("fs").readFileSync(process.env.ANCHOR_WALLET, {
        encoding: "utf-8",
      })
    )
  )
)

describe("game-core", () => {
  anchor.setProvider(anchor.AnchorProvider.env())

  const program = anchor.workspace.GameCore as Program<GameCore>

  it("Can initialize the palace", async () => {
    // get palace PDA
    const palaceAddress = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("palace"), program.provider.publicKey.toBytes()],
      anchor.workspace.GameCore.programId
    )[0]

    console.log(palaceAddress.toString())
    // Add your test here.
    const tx = await program.methods
      .initialize()
      .accounts({
        palace: palaceAddress,
      })
      .rpc()
    console.log("Your transaction signature", tx)

    // fetch the palace account
    const palace = await program.account.palace.fetch(palaceAddress)
    console.log(palace)
  })

  it("Can upgrade the palace", async () => {
    // get palace PDA
    const palaceAddress = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("palace"), program.provider.publicKey.toBytes()],
      anchor.workspace.GameCore.programId
    )[0]

    console.log(palaceAddress.toString())

    const tx = await program.methods
      .upgradePalace()
      .accounts({
        palace: palaceAddress,
      })
      .rpc()

    console.log("Your transaction signature", tx)

    // fetch the palace account
    const palace = await program.account.palace.fetch(palaceAddress)
    console.log(palace)
  })

  it("Can create a token mint", async () => {
    // get palace PDA
    const mintAddress = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mint")],
      anchor.workspace.GameCore.programId
    )[0]

    const tx = await program.methods
      .createTokenMint()
      .accounts({
        mint: mintAddress,
      })
      .rpc()

    console.log("Your transaction signature", tx)
  })

  it("Can mint tokens to a wallet", async () => {
    // get palace PDA
    const mint = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mint")],
      anchor.workspace.GameCore.programId
    )[0]

    const destination = new anchor.web3.Keypair().publicKey
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
        .mintTokens()
        .accounts({
          mint,
          destinationAta: ata,
        })
        .instruction()
    )

    const message = new anchor.web3.TransactionMessage({
      instructions: ixs,
      payerKey: program.provider.publicKey,
      recentBlockhash: (await program.provider.connection.getRecentBlockhash())
        .blockhash,
    }).compileToV0Message()

    const tx = new anchor.web3.VersionedTransaction(message)

    tx.sign([payer])

    let previousBalance = 0

    if (account) {
      previousBalance = Number(
        (await program.provider.connection.getTokenAccountBalance(ata)).value
          .amount
      )
    }

    const txid = await program.provider.connection.sendTransaction(tx)

    await program.provider.connection.confirmTransaction(txid)
    const newBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(ata)).value
        .amount
    )

    expect(newBalance).to.be.greaterThan(previousBalance)
  })
})
