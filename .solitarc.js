const path = require("path")
const programDir = path.join(__dirname, "programs/game-core")
const idlDir = path.join(__dirname, "idl")
const sdkDir = path.join(__dirname, "generated")
const binaryInstallDir = path.join(__dirname, ".crates")

module.exports = {
  idlGenerator: "anchor",
  programName: "game_core",
  programId: "9LqUvkM7zkVqpYypCRsuh5KitHbZZFrcfwkRVgirnnUf",
  idlDir,
  sdkDir,
  binaryInstallDir,
  programDir,
  rustbin: {
    locked: true,
    versionRangeFallback: "0.27.0",
  },
}
