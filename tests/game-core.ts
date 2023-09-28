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

  it("Tokens can be collected to the player vault", async () => {
    // get palace PDA
    const ata = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player_vault"), program.provider.publicKey.toBytes()],
      anchor.workspace.GameCore.programId
    )[0]

    const ix = await program.methods
      .collectTokens()
      .accounts({
        owner: program.provider.publicKey,
      })
      .instruction()

    const message = new anchor.web3.TransactionMessage({
      instructions: [ix],
      payerKey: program.provider.publicKey,
      recentBlockhash: (await program.provider.connection.getRecentBlockhash())
        .blockhash,
    }).compileToV0Message()

    const tx = new anchor.web3.VersionedTransaction(message)

    tx.sign([payer])

    let previousBalance = 0

    const txid = await program.provider.connection.sendTransaction(tx)

    await program.provider.connection.confirmTransaction(txid)
    const newBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(ata)).value
        .amount
    )

    expect(newBalance).to.be.greaterThan(previousBalance)
  })

  it("The player vault can be used to hire lumberjacks and miners using tokens", async () => {
    // get player PDA
    const playerAddress = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player"), program.provider.publicKey.toBytes()],
      anchor.workspace.GameCore.programId
    )[0]

    const playerVault = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player_vault"), program.provider.publicKey.toBytes()],
      anchor.workspace.GameCore.programId
    )[0]

    let previousBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(playerVault))
        .value.amount
    )

    const amountToHire = new anchor.BN(1000)
    // Purchase a lumberjack
    await program.methods
      .purchaseMerchantItem("Lumberjack", amountToHire)
      .accounts({ owner: program.provider.publicKey })
      .rpc()

    // fetch the player account
    let player = await program.account.player.fetch(playerAddress)
    let newBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(playerVault))
        .value.amount
    )

    expect(player.lumberjacks.eq(amountToHire)).to.be.true
    expect(previousBalance).to.be.greaterThan(newBalance)

    previousBalance = newBalance
    // Purchase a miner
    await program.methods
      .purchaseMerchantItem("Miner", amountToHire)
      .accounts({ owner: program.provider.publicKey })
      .rpc()

    // fetch the player account
    player = await program.account.player.fetch(playerAddress)
    newBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(playerVault))
        .value.amount
    )

    expect(player.miners.eq(amountToHire)).to.be.true
    expect(previousBalance).to.be.greaterThan(newBalance)
  })

  it('The player can collect lumber and gold from their "workers"', async () => {
    // get player PDA
    const playerAddress = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player"), program.provider.publicKey.toBytes()],
      anchor.workspace.GameCore.programId
    )[0]

    // fetch the player account
    const player = await program.account.player.fetch(playerAddress)

    await program.methods
      .collectResources()
      .accounts({ owner: program.provider.publicKey })
      .rpc()

    // fetch the player account
    const newPlayer = await program.account.player.fetch(playerAddress)

    expect(newPlayer.lumber.gt(player.lumber)).to.be.true
    expect(newPlayer.gold.gt(player.gold)).to.be.true
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

    const txid = await program.methods
      .upgradePalace()
      .accounts({ owner: program.provider.publicKey })
      .rpc()

    await program.provider.connection.confirmTransaction(txid)

    // fetch the palace account
    const palace = await program.account.playerPalace.fetch(palaceAddress)

    expect(palace.level).to.be.greaterThan(previousLevel)

    const newPlayerAccount = await program.account.player.fetch(playerAddress)

    expect(previousPlayerAccount.lumber.gt(newPlayerAccount.lumber)).to.be.true
    expect(previousPlayerAccount.gold.gt(newPlayerAccount.gold)).to.be.true
  })

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
})
