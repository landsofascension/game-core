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
  const testPlayerUsername = "admin"
  const adminStartingData = {
    lumber: 0,
    gold: 0,
    lumberjacks: 0,
    miners: 0,
  }
  const adminCollectingMinimumInHours = 2
  const amountToHire = new anchor.BN(1000)

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
        1e9
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

    expect(player.lumber.eq(new anchor.BN(adminStartingData.lumber))).to.be.true
    expect(player.gold.eq(new anchor.BN(adminStartingData.lumber))).to.be.true
  })

  it("The player can collect 3 tokens per hour from their vault", async () => {
    await program.methods
      .collectPalaceTokens()
      .accounts({
        player: playerAddress,
        signer: gameAuthority.publicKey,
      })
      .signers([gameAuthority])
      .rpc()

    const newBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(playerVault))
        .value.amount
    )

    // expect 1 second tokens reward = 3 tokens per hour / 3600 seconds
    const rewardPerSecond = new anchor.BN(3).div(new anchor.BN(3600))
    expect(newBalance).greaterThanOrEqual(rewardPerSecond.toNumber())
  })

  it("The player can use their vault tokens to hire lumberjacks and miners", async () => {
    let previousBalance = Number(
      (await program.provider.connection.getTokenAccountBalance(playerVault))
        .value.amount
    )

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

    expect(
      player.lumberjacks.eq(
        amountToHire.add(new anchor.BN(adminStartingData.lumberjacks))
      )
    ).to.be.true
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

    expect(
      player.miners.eq(
        amountToHire.add(new anchor.BN(adminStartingData.miners))
      )
    ).to.be.true
    expect(previousBalance).to.be.greaterThan(newBalance)
  })

  it(`The player can collect lumber and gold after waiting ${adminCollectingMinimumInHours} hours`, async () => {
    // fetch the player account
    const player = await program.account.player.fetch(playerAddress)

    const txid = await program.methods
      .collectPlayerResources()
      .accounts({
        player: playerAddress,
        signer: gameAuthority.publicKey,
      })
      .signers([gameAuthority])
      .rpc()

    // fetch the player account
    const updatedPlayer = await program.account.player.fetch(playerAddress)

    expect(
      updatedPlayer.lumber.eq(
        player.lumber.add(
          new anchor.BN(adminStartingData.lumberjacks)
            .add(amountToHire)
            .mul(new anchor.BN(adminCollectingMinimumInHours))
        )
      )
    ).to.be.true
    expect(
      updatedPlayer.gold.eq(
        player.gold.add(
          new anchor.BN(adminStartingData.miners)
            .add(amountToHire)
            .mul(new anchor.BN(adminCollectingMinimumInHours))
        )
      )
    ).to.be.true
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
    await new Promise((resolve) => setTimeout(resolve, 1000))
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
