# game-core

Core program for the game

## dev requisites

- Install Anchor and all its dependencies on https://www.anchor-lang.com/docs/installation

## development

- Clone the repo
- Run `yarn install`
- Run `anchor build` to build
- Run `anchor test` to run tests
- Run `anchor deploy` to deploy

## using it

To call the program from the client side:

- Install the Anchor TS SDK: `yarn add @coral-xyz/anchor`
- Copy the `target/types` folder into your app
- Initialize the program with

```ts
const program = new Program(
  IDL,
  PROGRAM_ID,
  new AnchorProvider(connection, wallet, {})
)
```

- Call methods with

```ts
const ix = await program.methods
  .initialize()
  .accounts({
    palace: palaceAddress,
  })
  .instruction()
```
