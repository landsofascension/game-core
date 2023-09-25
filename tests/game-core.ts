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

  it("The player can sign up their account to initialize all core accounts", async () => {
    // get palace PDA
    const palaceAddress = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("palace"), program.provider.publicKey.toBytes()],
      anchor.workspace.GameCore.programId
    )[0]

    // get player PDA
    const playerAddress = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player"), program.provider.publicKey.toBytes()],
      anchor.workspace.GameCore.programId
    )[0]

    // Add your test here.
    const tx = await program.methods
      .initialize()
      .accounts({
        palace: palaceAddress,
        player: playerAddress,
      })
      .rpc()

    // fetch the palace account
    const palace = await program.account.playerPalace.fetch(palaceAddress)

    // fetch the player account
    const player = await program.account.player.fetch(playerAddress)

    expect(palace.level).to.be.eq(1)
    expect(player.lumber.eq(new anchor.BN(0))).to.be.true
  })

  it("The program can create a token mint", async () => {
    // get palace PDA
    const mintAddress = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mint")],
      anchor.workspace.GameCore.programId
    )[0]

    await program.methods
      .createTokenMint()
      .accounts({
        mint: mintAddress,
      })
      .rpc()

    const mint = await program.provider.connection.getAccountInfo(mintAddress)

    expect(mint).to.not.be.null
  })

  it("The player can collect tokens", async () => {
    // get palace PDA
    const mint = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mint")],
      anchor.workspace.GameCore.programId
    )[0]

    const destination = payer.publicKey
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

  it("The player can hire lumberjacks and miners using tokens", async () => {
    // get player PDA
    const playerAddress = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player"), program.provider.publicKey.toBytes()],
      anchor.workspace.GameCore.programId
    )[0]

    const mint = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mint")],
      anchor.workspace.GameCore.programId
    )[0]

    const ata = await getAssociatedTokenAddress(mint, payer.publicKey)

    let previousBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(ata)).value
        .amount
    )

    // Purchase a lumberjack
    await program.methods
      .purchaseMerchantItem("Lumberjack")
      .accounts({ fromAta: ata })
      .rpc()

    // fetch the player account
    let player = await program.account.player.fetch(playerAddress)
    let newBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(ata)).value
        .amount
    )

    expect(player.lumberjacks.gt(new anchor.BN(0))).to.be.true
    expect(previousBalance).to.be.greaterThan(newBalance)

    previousBalance = newBalance
    // Purchase a miner
    await program.methods
      .purchaseMerchantItem("Miner")
      .accounts({ fromAta: ata })
      .rpc()

    // fetch the player account
    player = await program.account.player.fetch(playerAddress)
    newBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(ata)).value
        .amount
    )

    expect(player.miners.gt(new anchor.BN(0))).to.be.true
    expect(previousBalance).to.be.greaterThan(newBalance)
  })

  it("The player can upgrade the palace", async () => {
    // get palace PDA
    const palaceAddress = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("palace"), program.provider.publicKey.toBytes()],
      anchor.workspace.GameCore.programId
    )[0]

    const playerAddress = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player"), program.provider.publicKey.toBytes()],
      anchor.workspace.GameCore.programId
    )[0]

    const previousLevel = (
      await program.account.playerPalace.fetch(palaceAddress)
    ).level

    const previousPlayerAccount = await program.account.player.fetch(
      playerAddress
    )

    const txid = await program.methods.upgradePalace().accounts({}).rpc()

    await program.provider.connection.confirmTransaction(txid)

    // fetch the palace account
    const palace = await program.account.playerPalace.fetch(palaceAddress)

    expect(palace.level).to.be.greaterThan(previousLevel)

    const newPlayerAccount = await program.account.player.fetch(playerAddress)

    expect(previousPlayerAccount.lumber.gt(newPlayerAccount.lumber)).to.be.true
    expect(previousPlayerAccount.gold.gt(newPlayerAccount.gold)).to.be.true
  })

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    console.info("⏳ waiting 1s for tx to be confirmed")
  })
})
