use anchor_lang::prelude::*;
use anchor_spl::token::{ Token, Mint, MintTo, mint_to, TokenAccount, burn };

declare_id!("9LqUvkM7zkVqpYypCRsuh5KitHbZZFrcfwkRVgirnnUf");

#[account]
pub struct Player {
    pub experience: u64,
    pub gold: u64,
    pub lumber: u64,
    pub miners: u64,
    pub lumberjacks: u64,
}

#[account]
// This is attached to the player account because each palace has its own level
pub struct PlayerPalace {
    pub level: u32,
    pub last_mint_timestamp: i64,
}

#[account]
// This is attached to the player account because each merchant has its own level
pub struct PlayerMerchant {
    pub level: u32,
}

const MERCHANT_ITEMS: [&str; 2] = ["Lumberjack", "Miner"];
const MERCHANT_ITEMS_COST: [u64; 2] = [1000, 500];

#[program]
pub mod game_core {
    use anchor_spl::token::Burn;

    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let clock = Clock::get()?;
        let ts_now = clock.unix_timestamp;

        // init player
        ctx.accounts.player.set_inner(Player {
            experience: 0,
            gold: 0,
            lumber: 0,
            miners: 0,
            lumberjacks: 0,
        });

        // init buildings
        ctx.accounts.palace.set_inner(PlayerPalace {
            level: 1,
            last_mint_timestamp: ts_now,
        });

        ctx.accounts.merchant.set_inner(PlayerMerchant {
            level: 0,
        });

        Ok(())
    }

    pub fn purchase_merchant_item(
        ctx: Context<PurchaseMerchantItem>,
        item: String,
        amount: u64
    ) -> Result<()> {
        let found = MERCHANT_ITEMS.iter().position(|&i| i == item);

        match found {
            None => {
                return err!(ErrorCodes::MerchantItemNotFound);
            }
            Some(_) => {
                let item = MERCHANT_ITEMS[found.unwrap()];
                let cost = MERCHANT_ITEMS_COST[found.unwrap()];

                msg!("purchasing item: {}", item);
                msg!("cost: {}", cost);

                // add item
                match item {
                    "Lumberjack" => {
                        ctx.accounts.player.lumberjacks =
                            ctx.accounts.player.lumberjacks + 1 * amount;
                    }
                    "Miner" => {
                        ctx.accounts.player.miners = ctx.accounts.player.miners + 1 * amount;
                    }
                    // item configured but not implemented
                    _ => {
                        return err!(ErrorCodes::MerchantItemNotFound);
                    }
                }

                // burn tokens from player vault
                let token_program = &ctx.accounts.token_program;
                let authority = &ctx.accounts.mint;

                let cpi_accounts = Burn {
                    mint: ctx.accounts.mint.to_account_info().clone(),
                    from: ctx.accounts.player_vault.to_account_info().clone(),
                    authority: authority.to_account_info().clone(),
                };

                let bump = *ctx.bumps.get("mint").unwrap();

                let result = burn(
                    CpiContext::new_with_signer(
                        token_program.to_account_info(),
                        cpi_accounts,
                        &[&[b"mint", &[bump]]]
                    ),
                    cost
                );

                match result {
                    Ok(_) => {}
                    Err(e) => {
                        msg!("error burning tokens: {:?}", e);
                        return err!(ErrorCodes::CouldNotBurnTokens);
                    }
                }
            }
        }

        Ok(())
    }

    pub fn upgrade_palace(ctx: Context<Upgrade>) -> Result<()> {
        // Cost for upgrade based on Palace level
        let cost_gold = (ctx.accounts.palace.level as u64) * 1000;
        let cost_lumber = (ctx.accounts.palace.level as u64) * 100;

        // Check if player has enough gold
        if ctx.accounts.player.gold < cost_gold {
            return err!(ErrorCodes::NotEnoughGold);
        }

        // Check if player has enough lumber
        if ctx.accounts.player.lumber < cost_lumber {
            return err!(ErrorCodes::NotEnoughLumber);
        }

        ctx.accounts.player.gold = ctx.accounts.player.gold - cost_gold;
        ctx.accounts.player.lumber = ctx.accounts.player.lumber - cost_lumber;

        // Upgrade palace
        ctx.accounts.palace.level = ctx.accounts.palace.level + 1;

        Ok(())
    }

    pub fn create_token_mint(_ctx: Context<CreateTokenMint>) -> Result<()> {
        Ok(())
    }

    pub fn collect_tokens(ctx: Context<CollectTokens>) -> Result<()> {
        let token_program = ctx.accounts.token_program.to_account_info();

        let mint_to_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.player_vault.to_account_info(),
            authority: ctx.accounts.mint.to_account_info(),
        };
        let bump = *ctx.bumps.get("mint").unwrap();

        let clock = Clock::get()?;
        let ts_now = clock.unix_timestamp;

        // 1 token per second
        let seconds_elapsed = ts_now - ctx.accounts.palace.last_mint_timestamp;
        let amount = (seconds_elapsed * 10000) as u64;

        msg!("minting {} tokens", amount);

        // mint tokens
        mint_to(
            CpiContext::new_with_signer(token_program, mint_to_accounts, &[&[b"mint", &[bump]]]),
            amount
        )?;

        // update the palace
        ctx.accounts.palace.set_inner(PlayerPalace {
            last_mint_timestamp: ts_now,
            ..ctx.accounts.palace.clone().into_inner()
        });

        Ok(())
    }

    pub fn collect_resources(ctx: Context<CollectResources>) -> Result<()> {
        // @TODO use timestamp to calculate how much resources to add
        ctx.accounts.player.gold = ctx.accounts.player.gold + ctx.accounts.player.miners * 10;
        ctx.accounts.player.lumber =
            ctx.accounts.player.lumber + ctx.accounts.player.lumberjacks * 10;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = signer,
        space = 8 + 8 * 5, // 4 fields of 8 bytes each
        seeds = [b"player".as_ref(), signer.key().as_ref()],
        bump
    )]
    pub player: Account<'info, Player>,
    #[account(
        init,
        payer = signer,
        seeds = [b"player_vault".as_ref(), signer.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = mint
    )]
    pub player_vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = signer,
        space = 8 + 8 * 4, // 4 fields of 8 bytes each
        seeds = [b"palace".as_ref(), signer.key().as_ref()],
        bump
    )]
    pub palace: Account<'info, PlayerPalace>,
    #[account(
        init,
        payer = signer,
        space = 8 + 8 * 4, // 4 fields of 8 bytes each
        seeds = [b"merchant".as_ref(), signer.key().as_ref()],
        bump
    )]
    pub merchant: Account<'info, PlayerMerchant>,
    #[account(mut, seeds = [b"mint".as_ref()], bump)]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CollectTokens<'info> {
    #[account(mut)]
    /// CHECK: only to grab the PDA
    pub owner: AccountInfo<'info>,
    #[account(mut, seeds = [b"mint".as_ref()], bump)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"player_vault".as_ref(), owner.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = mint
    )]
    pub player_vault: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"palace".as_ref(), owner.key().as_ref()], bump)]
    pub palace: Account<'info, PlayerPalace>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct PurchaseMerchantItem<'info> {
    #[account(mut, seeds = [b"player".as_ref(), owner.key().as_ref()], bump)]
    pub player: Account<'info, Player>,
    #[account(mut, seeds = [b"merchant".as_ref(), owner.key().as_ref()], bump)]
    pub merchant: Account<'info, PlayerMerchant>,
    #[account(
        mut,
        seeds = [b"player_vault".as_ref(), owner.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = mint
    )]
    pub player_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    /// CHECK: only to grab the PDA
    pub owner: AccountInfo<'info>,
    #[account(mut, seeds = [b"mint".as_ref()], bump)]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CollectResources<'info> {
    #[account(mut)]
    /// CHECK: only to grab the PDA
    pub owner: AccountInfo<'info>,
    #[account(mut, seeds = [b"player".as_ref(), owner.key().as_ref()], bump)]
    pub player: Account<'info, Player>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Upgrade<'info> {
    #[account(mut, seeds = [b"palace".as_ref(), owner.key().as_ref()], bump)]
    pub palace: Account<'info, PlayerPalace>,
    #[account(mut)]
    /// CHECK: only to grab the PDA
    pub owner: AccountInfo<'info>,
    #[account(mut, seeds = [b"player".as_ref(), owner.key().as_ref()], bump)]
    pub player: Account<'info, Player>,
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

#[error_code]
pub enum ErrorCodes {
    #[msg("Merchant item not found")]
    MerchantItemNotFound,
    #[msg("Not enough gold")]
    NotEnoughGold,
    #[msg("Not enough lumber")]
    NotEnoughLumber,
    #[msg("Could not burn tokens")]
    CouldNotBurnTokens,
}
