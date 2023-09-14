use anchor_lang::prelude::*;

declare_id!("9LqUvkM7zkVqpYypCRsuh5KitHbZZFrcfwkRVgirnnUf");

#[program]
pub mod game_core {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
