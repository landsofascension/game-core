import * as anchor from "@coral-xyz/anchor"
import { Program } from "@coral-xyz/anchor"
import { GameCore } from "../target/types/game_core"
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token"
import { expect } from "chai"
import {
  getCollectTokensInstructions,
  getCreateTokenMintInstructions,
  getInitializeInstructions,
  getPurchaseMerchantItemInstructions,
} from "../src"

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
    const { instructions, palaceAddress, playerAddress } =
      await getInitializeInstructions(program, payer.publicKey)

    await program.provider.sendAndConfirm(
      new anchor.web3.Transaction().add(...instructions)
    )

    // fetch the palace account
    const palace = await program.account.playerPalace.fetch(palaceAddress)

    // fetch the player account
    const player = await program.account.player.fetch(playerAddress)

    expect(palace.level).to.be.eq(1)
    expect(player.lumber.eq(new anchor.BN(0))).to.be.true
  })

  it("The program can create a token mint", async () => {
    const { instructions, mintAddress } = await getCreateTokenMintInstructions(
      program
    )

    await program.provider.sendAndConfirm(
      new anchor.web3.Transaction().add(...instructions)
    )

    const mint = await program.provider.connection.getAccountInfo(mintAddress)

    expect(mint).to.not.be.null
  })

  it("The player can collect tokens", async () => {
    // get palace PDA
    const { account, ata, instructions } = await getCollectTokensInstructions(
      program,
      payer.publicKey
    )

    let previousBalance = 0

    if (account) {
      previousBalance = Number(
        (await program.provider.connection.getTokenAccountBalance(ata)).value
          .amount
      )
    }

    await program.provider.sendAndConfirm(
      new anchor.web3.Transaction().add(...instructions)
    )

    const newBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(ata)).value
        .amount
    )

    expect(newBalance).to.be.greaterThan(previousBalance)
  })

  it("The player can hire lumberjacks and miners using tokens", async () => {
    // get player PDA

    const amountToHire = new anchor.BN(1000)

    const { ata, instructions, playerAddress } =
      await getPurchaseMerchantItemInstructions(
        program,
        payer.publicKey,
        "Lumberjack",
        amountToHire
      )

    let previousBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(ata)).value
        .amount
    )

    await program.provider.sendAndConfirm(
      new anchor.web3.Transaction().add(...instructions)
    )

    // fetch the player account
    let player = await program.account.player.fetch(playerAddress)
    let newBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(ata)).value
        .amount
    )

    expect(player.lumberjacks.eq(amountToHire)).to.be.true
    expect(previousBalance).to.be.greaterThan(newBalance)

    previousBalance = newBalance
    // Purchase a miner
    const { instructions: ixs2 } = await getPurchaseMerchantItemInstructions(
      program,
      payer.publicKey,
      "Miner",
      amountToHire
    )

    await program.provider.sendAndConfirm(
      new anchor.web3.Transaction().add(...ixs2)
    )

    // fetch the player account
    player = await program.account.player.fetch(playerAddress)
    newBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(ata)).value
        .amount
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

    await program.methods.collectResources().accounts({}).rpc()

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
