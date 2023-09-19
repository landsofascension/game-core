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

    pub fn create_token_mint(_ctx: Context<CreateTokenMint>) -> Result<()> {
        Ok(())
    }

    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        let token_program = ctx.accounts.token_program.to_account_info();
        let mint_to_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.destination_ata.to_account_info(),
            authority: ctx.accounts.mint.to_account_info(),
        };
        let bump = *ctx.bumps.get("mint").unwrap();

        mint_to(
            CpiContext::new_with_signer(token_program, mint_to_accounts, &[&[b"mint", &[bump]]]),
            amount
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = signer,
        space = 8 + 8,
        seeds = [b"palace".as_ref(), signer.key().as_ref()],
        bump
    )]
    pub palace: Account<'info, Palace>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Upgrade<'info> {
    #[account(mut, seeds = [b"palace".as_ref(), signer.key().as_ref()], bump)]
    pub palace: Account<'info, Palace>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateTokenMint<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        init,
        seeds = [b"mint".as_ref()],
        bump,
        payer = signer,
        mint::decimals = 0,
        mint::authority = mint
    )]
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintTokens<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [b"mint".as_ref()], bump)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub destination_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
