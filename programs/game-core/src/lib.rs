use anchor_lang::prelude::*;

use anchor_spl::{ token::{ Token, Mint, MintTo, mint_to, TokenAccount } };

declare_id!("9LqUvkM7zkVqpYypCRsuh5KitHbZZFrcfwkRVgirnnUf");

#[account]
pub struct Palace {
    pub level: i8,
}

#[program]
pub mod game_core {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.palace.set_inner(Palace {
            level: 1,
        });

        Ok(())
    }

    pub fn upgrade_palace(ctx: Context<Upgrade>) -> Result<()> {
        ctx.accounts.palace.level = ctx.accounts.palace.level + 1;

        Ok(())
    }

    pub fn mint_tokens(ctx: Context<Auth>, amount: u64) -> Result<()> {
        // Create the MintTo struct for our context
        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.destination_ata.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        // Create the CpiContext we need for the request
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        // Execute anchor's helper function to mint tokens
        mint_to(cpi_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = signer, space = 8 + 8, seeds = [signer.key().as_ref()], bump)]
    pub palace: Account<'info, Palace>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Upgrade<'info> {
    #[account(mut, seeds = [signer.key().as_ref()], bump)]
    pub palace: Account<'info, Palace>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Auth<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub destination_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
