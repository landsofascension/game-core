use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_spl::token::{ Token, Mint, MintTo, mint_to, TokenAccount, burn };

declare_id!("9LqUvkM7zkVqpYypCRsuh5KitHbZZFrcfwkRVgirnnUf");

#[account]
pub struct Player {
    pub username: String,
    pub experience: u64,
    pub gold: u64,
    pub lumber: u64,
    pub miners: u64,
    pub lumberjacks: u64,
}

#[account]
// This is attached to the player account because each player_palace has its own level
pub struct PlayerPalace {
    pub level: u32,
    pub last_mint_timestamp: i64,
}

#[account]
// This is attached to the player account because each player_merchant has its own level
pub struct PlayerMerchant {
    pub level: u32,
}

const MERCHANT_ITEMS: [&str; 2] = ["Lumberjack", "Miner"];
const MERCHANT_ITEMS_COST: [u64; 2] = [1000, 500];

#[program]
pub mod game_core {
    use anchor_spl::token::Burn;

    use super::*;

    #[access_control(only_authority(&ctx.accounts.signer.key))]
    pub fn sign_up_player(ctx: Context<SignUpPlayer>, username: String) -> Result<()> {
        let clock = Clock::get()?;
        let ts_now = clock.unix_timestamp;

        // init player
        ctx.accounts.player.set_inner(Player {
            username,
            experience: 0,
            gold: 0,
            lumber: 0,
            miners: 0,
            lumberjacks: 0,
        });

        // init buildings
        ctx.accounts.player_palace.set_inner(PlayerPalace {
            level: 1,
            last_mint_timestamp: ts_now,
        });

        ctx.accounts.player_merchant.set_inner(PlayerMerchant {
            level: 0,
        });

        Ok(())
    }

    #[access_control(only_authority(&ctx.accounts.signer.key))]
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

    #[access_control(only_authority(&ctx.accounts.signer.key))]
    pub fn upgrade_player_palace(ctx: Context<UpgradePlayerPalace>) -> Result<()> {
        // Cost for upgrade based on Palace level
        let cost_gold = (ctx.accounts.player_palace.level as u64) * 1000;
        let cost_lumber = (ctx.accounts.player_palace.level as u64) * 100;

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

        // Upgrade player_palace
        ctx.accounts.player_palace.level = ctx.accounts.player_palace.level + 1;

        Ok(())
    }

    #[access_control(only_authority(&ctx.accounts.signer.key))]
    pub fn create_token_mint(ctx: Context<CreateTokenMint>) -> Result<()> {
        Ok(())
    }

    #[access_control(only_authority(&ctx.accounts.signer.key))]
    pub fn collect_palace_tokens(ctx: Context<CollectPalaceTokens>) -> Result<()> {
        let token_program = ctx.accounts.token_program.to_account_info();

        let mint_to_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.player_vault.to_account_info(),
            authority: ctx.accounts.mint.to_account_info(),
        };

        let clock = Clock::get()?;
        let ts_now = clock.unix_timestamp;

        // 1 token per second
        let seconds_elapsed = ts_now - ctx.accounts.player_palace.last_mint_timestamp;
        let amount = (seconds_elapsed * 10000) as u64;

        let mint_bump = *ctx.bumps.get("mint").unwrap();

        msg!("minting {} tokens", amount);

        // mint tokens
        mint_to(
            CpiContext::new_with_signer(
                token_program,
                mint_to_accounts,
                &[&[b"mint", &[mint_bump]]]
            ),
            amount
        )?;

        // update the player_palace
        ctx.accounts.player_palace.set_inner(PlayerPalace {
            last_mint_timestamp: ts_now,
            ..ctx.accounts.player_palace.clone().into_inner()
        });

        Ok(())
    }

    #[access_control(only_authority(&ctx.accounts.signer.key))]
    pub fn collect_player_resources(ctx: Context<CollectPlayerResources>) -> Result<()> {
        // @TODO use timestamp to calculate how much resources to add
        ctx.accounts.player.gold = ctx.accounts.player.gold + ctx.accounts.player.miners * 10;
        ctx.accounts.player.lumber =
            ctx.accounts.player.lumber + ctx.accounts.player.lumberjacks * 10;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(username: String)]
pub struct SignUpPlayer<'info> {
    #[account(
        init,
        payer = signer,
        space = 8 + 8 * 5 + 24, // 8(pubkey) + 8(u64 fields) * 5 + 24(string field)
        seeds = [b"player".as_ref(), username.as_bytes().as_ref()],
        bump
    )]
    pub player: Account<'info, Player>,
    #[account(
        init,
        payer = signer,
        seeds = [b"player_vault".as_ref(), player.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = mint
    )]
    pub player_vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = signer,
        space = 8 + 8 * 4, // 4 fields of 8 bytes each
        seeds = [b"player_palace".as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_palace: Account<'info, PlayerPalace>,
    #[account(
        init,
        payer = signer,
        space = 8 + 8 * 4, // 4 fields of 8 bytes each
        seeds = [b"player_merchant".as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_merchant: Account<'info, PlayerMerchant>,
    #[account(mut, seeds = [b"mint".as_ref()], bump)]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CollectPalaceTokens<'info> {
    #[account(mut)]
    pub player: Account<'info, Player>,
    #[account(mut, seeds = [b"mint".as_ref()], bump)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"player_vault".as_ref(), player.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = mint
    )]
    pub player_vault: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"player_palace".as_ref(), player.key().as_ref()], bump)]
    pub player_palace: Account<'info, PlayerPalace>,
    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct PurchaseMerchantItem<'info> {
    #[account(mut)]
    pub player: Account<'info, Player>,
    #[account(mut, seeds = [b"player_merchant".as_ref(), player.key().as_ref()], bump)]
    pub player_merchant: Account<'info, PlayerMerchant>,
    #[account(
        mut,
        seeds = [b"player_vault".as_ref(), player.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = mint
    )]
    pub player_vault: Account<'info, TokenAccount>,

    #[account(mut, seeds = [b"mint".as_ref()], bump)]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    #[account(mut)]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct CollectPlayerResources<'info> {
    #[account(mut)]
    pub player: Account<'info, Player>,
    pub system_program: Program<'info, System>,
    #[account(mut)]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpgradePlayerPalace<'info> {
    #[account(mut)]
    pub player: Account<'info, Player>,
    #[account(mut, seeds = [b"player_palace".as_ref(), player.key().as_ref()], bump)]
    pub player_palace: Account<'info, PlayerPalace>,
    pub system_program: Program<'info, System>,
    #[account(mut)]
    pub signer: Signer<'info>,
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
    #[msg("Unauthorized")]
    Unauthorized,
}

// Custom access control for only allowing the game authority to call the methods
fn only_authority(signer: &Pubkey) -> Result<()> {
    let game_authority_string = "6e9pMiMWPdma3ohzcSHo4QGYMuFNqojQ7KKtz1Ri4qvd";
    let game_authority = Pubkey::from_str(game_authority_string).unwrap();

    if *signer != game_authority {
        return Err(ErrorCodes::Unauthorized.into());
    }

    Ok(())
}
