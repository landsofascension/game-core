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
    pub last_resources_timestamp: u64,
}

#[account]
// This is attached to the player account because each player_palace has its own level
pub struct PlayerPalace {
    pub level: u32,
    pub last_mint_timestamp: u64,
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
        let ts_now = clock.unix_timestamp as u64;

        let miners = 0;
        let lumberjacks = 0;
        let gold = 0;
        let lumber = 0;

        // init player
        ctx.accounts.player.set_inner(Player {
            username,
            experience: 0,
            gold,
            lumber,
            miners,
            lumberjacks,
            last_resources_timestamp: 0,
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

                // reset resources collect timestamp
                let ts_now = Clock::get()?.unix_timestamp as u64;
                ctx.accounts.player.last_resources_timestamp = ts_now;

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
        let palace_level = ctx.accounts.player_palace.level as u64;

        let (gold_cost, lumber_cost) = match palace_level {
            1 => (100, 100), // Palace 1 costs 100 gold and 100 lumber
            2 => (210, 210), // Palace 2 costs 210 gold and 210 lumber
            3 => (480, 480), // Palace 3 costs 480 gold and 480 lumber
            4 => (1050, 1050), // Palace 4 costs 1050 gold and 1050 lumber
            5 => (2400, 2400), // Palace 5 costs 2400 gold and 2400 lumber
            _ => {
                // Use a custom function for levels beyond 5
                let gold_cost = ((palace_level as f64).exp2().ceil() as u64) * 100;
                let lumber_cost = ((palace_level as f64).exp2().ceil() as u64) * 100;
                (gold_cost, lumber_cost)
            }
        };

        // Check if player has enough gold
        if ctx.accounts.player.gold < gold_cost {
            return err!(ErrorCodes::NotEnoughGold);
        }

        // Check if player has enough lumber
        if ctx.accounts.player.lumber < lumber_cost {
            return err!(ErrorCodes::NotEnoughLumber);
        }

        ctx.accounts.player.gold = ctx.accounts.player.gold - gold_cost;
        ctx.accounts.player.lumber = ctx.accounts.player.lumber - lumber_cost;

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
        let mint_bump = *ctx.bumps.get("mint").unwrap();
        let clock = Clock::get()?;
        let ts_now = clock.unix_timestamp as u64;

        let mut seconds_elapsed = ts_now.saturating_sub(
            ctx.accounts.player_palace.last_mint_timestamp as u64
        );

        // @tests admin always gets at least 1 hour worth of tokens
        if ctx.accounts.player.username == "admin" {
            seconds_elapsed = if seconds_elapsed < 3600 { 3600 } else { seconds_elapsed };
        }

        let palace_level = ctx.accounts.player_palace.level;

        msg!("seconds elapsed: {}", seconds_elapsed);
        let amount_per_hour = match palace_level {
            1 => 3, // Palace 1 issues 3 tokens/hour
            2 => 7, // Palace 2 issues 7 tokens/hour
            3 => 18, // Palace 3 issues 18 tokens/hour
            4 => 40, // Palace 4 issues 40 tokens/hour
            5 => 88, // Palace 5 issues 88 tokens/hour
            _ => {
                // Use a custom function for levels beyond 5
                let base_issuance_rate = 88; // Customize the base issuance rate
                let additional_rate = (2u32).pow(palace_level - 5) * 5; // Customize the rate increase
                base_issuance_rate + additional_rate
            }
        };

        let token_decimals: u64 = 9;
        let amount_per_hour_with_decimals =
            (amount_per_hour as u64) * (10u64).pow(token_decimals as u32);

        let amount_per_second = amount_per_hour_with_decimals.checked_div(3600).unwrap();
        let amount = amount_per_second * seconds_elapsed;

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
        let clock = Clock::get()?;
        let ts_now = clock.unix_timestamp as u64;

        msg!("last resources timestamp: {}", ctx.accounts.player.last_resources_timestamp);

        if ctx.accounts.player.last_resources_timestamp == 0 {
            return err!(ErrorCodes::ResourcesNotInitialized);
        }
        let mut seconds_elapsed = ts_now.saturating_sub(
            ctx.accounts.player.last_resources_timestamp as u64
        );

        // @tests admin always gets at least 1 hour worth of resources
        if ctx.accounts.player.username == "admin" {
            seconds_elapsed = if seconds_elapsed < 3600 { 3600 } else { seconds_elapsed };
        }

        msg!("seconds elapsed: {}", seconds_elapsed);

        // check if 1 hour passed
        if seconds_elapsed < 3600 {
            return Ok(());
        }

        let hours_elapsed = seconds_elapsed / 3600;

        msg!("hours elapsed: {}", hours_elapsed);
        msg!("player gold: {}", ctx.accounts.player.gold);
        msg!("player lumber: {}", ctx.accounts.player.lumber);
        msg!("player miners: {}", ctx.accounts.player.miners);
        msg!("player lumberjacks: {}", ctx.accounts.player.lumberjacks);

        // add 1 resource per hour
        ctx.accounts.player.gold =
            ctx.accounts.player.gold + ctx.accounts.player.miners * hours_elapsed;
        ctx.accounts.player.lumber =
            ctx.accounts.player.lumber + ctx.accounts.player.lumberjacks * hours_elapsed;

        ctx.accounts.player.last_resources_timestamp = ts_now;

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
        mint::decimals = 9,
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
    #[msg("No resources to collect")]
    ResourcesNotInitialized,
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
