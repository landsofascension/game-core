import * as anchor from "@coral-xyz/anchor"
import { Program } from "@coral-xyz/anchor"
import { expect } from "chai"
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes"
import { before } from "mocha"
require("dotenv").config()
import { GameCore } from "../target/types/game_core"

if (
  !process.env.GAME_AUTHORITY_PRIVATE_KEY ||
  process.env.GAME_AUTHORITY_PRIVATE_KEY === ""
) {
  throw new Error(
    "Expected environment variable `GAME_AUTHORITY_PRIVATE_KEY` is not set."
  )
}

const gameAuthority = anchor.web3.Keypair.fromSecretKey(
  bs58.decode(process.env.GAME_AUTHORITY_PRIVATE_KEY as string)
)

describe("game-core", () => {
  anchor.setProvider(anchor.AnchorProvider.env())

  const program = anchor.workspace.GameCore as Program<GameCore>
  const testPlayerUsername = "test_player"

  const playerAddress = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("player"), Buffer.from(testPlayerUsername)],
    anchor.workspace.GameCore.programId
  )[0]

  const palaceAddress = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("player_palace"), playerAddress.toBytes()],
    anchor.workspace.GameCore.programId
  )[0]

  const playerVault = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("player_vault"), playerAddress.toBytes()],
    anchor.workspace.GameCore.programId
  )[0]

  before(async () => {
    // airdrop to game authority
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        gameAuthority.publicKey,
        1000000000000
      )
    )
  })
  it("The program can create a token mint", async () => {
    const mintAddress = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mint")],
      anchor.workspace.GameCore.programId
    )[0]

    await program.methods
      .createTokenMint()
      .accounts({
        mint: mintAddress,
        signer: gameAuthority.publicKey,
      })
      .signers([gameAuthority])
      .rpc()

    const mint = await program.provider.connection.getAccountInfo(mintAddress)

    expect(mint).to.not.be.null
  })

  it("The player can sign up their account to initialize all core accounts", async () => {
    await program.methods
      .signUpPlayer(testPlayerUsername)
      .accounts({
        signer: gameAuthority.publicKey,
      })
      .signers([gameAuthority])
      .rpc()

    // fetch the player_palace account
    const player_palace = await program.account.playerPalace.fetch(
      palaceAddress
    )

    // fetch the player account
    const player = await program.account.player.fetch(playerAddress)

    expect(player_palace.level).to.be.eq(1)
    expect(player.lumber.eq(new anchor.BN(0))).to.be.true
  })

  it("Tokens can be collected to the player vault", async () => {
    await program.methods
      .collectPalaceTokens()
      .accounts({
        player: playerAddress,
        signer: gameAuthority.publicKey,
      })
      .signers([gameAuthority])
      .rpc()

    let previousBalance = 0

    const newBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(playerVault))
        .value.amount
    )

    expect(newBalance).to.be.greaterThan(previousBalance)
  })

  it("The player can use their vault tokens to hire lumberjacks and miners", async () => {
    let previousBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(playerVault))
        .value.amount
    )

    const amountToHire = new anchor.BN(1000)
    // Purchase a lumberjack
    await program.methods
      .purchaseMerchantItem("Lumberjack", amountToHire)
      .accounts({
        player: playerAddress,
        signer: gameAuthority.publicKey,
      })
      .signers([gameAuthority])
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
      .accounts({
        player: playerAddress,
        signer: gameAuthority.publicKey,
      })
      .signers([gameAuthority])
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
    // fetch the player account
    const player = await program.account.player.fetch(playerAddress)

    await program.methods
      .collectPlayerResources()
      .accounts({
        player: playerAddress,
        signer: gameAuthority.publicKey,
      })
      .signers([gameAuthority])
      .rpc()

    // fetch the player account
    const newPlayer = await program.account.player.fetch(playerAddress)

    expect(newPlayer.lumber.gt(player.lumber)).to.be.true
    expect(newPlayer.gold.gt(player.gold)).to.be.true
  })

  it("The player can upgrade their palace", async () => {
    const previousLevel = (
      await program.account.playerPalace.fetch(palaceAddress)
    ).level

    const previousPlayerAccount = await program.account.player.fetch(
      playerAddress
    )

    const txid = await program.methods
      .upgradePlayerPalace()
      .accounts({
        player: playerAddress,
        signer: gameAuthority.publicKey,
      })
      .signers([gameAuthority])
      .rpc()

    await program.provider.connection.confirmTransaction(txid)

    // fetch the player_palace account
    const player_palace = await program.account.playerPalace.fetch(
      palaceAddress
    )

    expect(player_palace.level).to.be.greaterThan(previousLevel)

    const newPlayerAccount = await program.account.player.fetch(playerAddress)

    expect(previousPlayerAccount.lumber.gt(newPlayerAccount.lumber)).to.be.true
    expect(previousPlayerAccount.gold.gt(newPlayerAccount.gold)).to.be.true
  })

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500))
  })
})

// const anchorWallet = anchor.web3.Keypair.fromSecretKey(
//   Buffer.from(
//     JSON.parse(
//       require("fs").readFileSync(process.env.ANCHOR_WALLET, {
//         encoding: "utf-8",
//       })
//     )
//   )
// )
