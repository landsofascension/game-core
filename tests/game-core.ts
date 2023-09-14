import * as anchor from "@coral-xyz/anchor"
import { Program } from "@coral-xyz/anchor"
import { GameCore } from "../target/types/game_core"
import { getAssociatedTokenAddress } from "@solana/spl-token"

describe("game-core", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env())

  const program = anchor.workspace.GameCore as Program<GameCore>

  it("Is initialized!", async () => {
    // get palace PDA
    const palaceAddress = anchor.web3.PublicKey.findProgramAddressSync(
      [program.provider.publicKey.toBytes()],
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

  it("Can be upgraded", async () => {
    // get palace PDA
    const palaceAddress = anchor.web3.PublicKey.findProgramAddressSync(
      [program.provider.publicKey.toBytes()],
      anchor.workspace.GameCore.programId
    )[0]

    console.log(palaceAddress.toString())
    // Add your test here.
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

  it("Can mint tokens", async () => {
    // get palace PDA
    const mint = new anchor.web3.PublicKey(
      "4zfn53iuTbnQDsJDtJvnuhYaqC5JaGSPJUSvaG4zZT6u"
    )
    const destination = new anchor.web3.PublicKey(
      "7x4JZgW2oeAcra18oMC7Tudu9h6D5cYMJnjy8AbubBVW"
    )

    const ata = await getAssociatedTokenAddress(mint, destination)

    console.log(destination.toString())

    // Add your test here.
    const tx = await program.methods
      .mintTokens(new anchor.BN(1e9))
      .accounts({
        mint,
        destinationAta: ata,
      })
      .rpc()

    console.log("Your transaction signature", tx)
  })
})
