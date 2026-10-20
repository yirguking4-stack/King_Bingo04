-- ============================================================================
-- KING BINGO — DATABASE SCHEMA
-- Real platform components (users, games, admin, audit) + virtual economy
-- (wallet balances are virtual credits, never real currency)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Player ID counter (00001-99999). Used by backend/src/models/userModel.js
CREATE SEQUENCE IF NOT EXISTS user_id_5d_seq START 1 MAXVALUE 99999;

-- ----------------------------------------------------------------------------
-- USERS  (real Telegram identities)
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id                  BIGSERIAL PRIMARY KEY,
    telegram_id         BIGINT UNIQUE NOT NULL,
    user_id_5d          VARCHAR(5) UNIQUE NOT NULL CHECK (user_id_5d ~ '^[0-9]{5}$'),
    username            VARCHAR(64) NOT NULL,
    first_name          VARCHAR(128),
    last_name           VARCHAR(128),
    phone_number        VARCHAR(20),               -- shared via Telegram contact, informational only (no real payouts)
    referred_by         VARCHAR(5) REFERENCES users(user_id_5d),
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','BANNED')),
    is_admin            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_referred_by ON users(referred_by);

-- ----------------------------------------------------------------------------
-- WALLETS  (virtual credit balance — central wallet per user)
-- ----------------------------------------------------------------------------
CREATE TABLE wallets (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    balance             NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
    locked_balance      NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (locked_balance >= 0), -- e.g. bonus credits pending wagering requirement
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- TRANSACTIONS  (real audit-grade ledger of every virtual-credit movement)
-- ----------------------------------------------------------------------------
CREATE TABLE transactions (
    id                  BIGSERIAL PRIMARY KEY,
    public_id           UUID NOT NULL DEFAULT uuid_generate_v4(),
    user_id             BIGINT NOT NULL REFERENCES users(id),
    type                VARCHAR(30) NOT NULL CHECK (type IN (
                            'VIRTUAL_DEPOSIT', 'VIRTUAL_WITHDRAWAL', 'VIRTUAL_TRANSFER',
                            'GAME_ENTRY', 'GAME_REFUND', 'PRIZE', 'REFERRAL_BONUS',
                            'FIRST_JOIN_BONUS', 'ADMIN_CREDIT', 'ADMIN_DEBIT'
                        )),
    amount              NUMERIC(14,2) NOT NULL,
    balance_before       NUMERIC(14,2) NOT NULL,
    balance_after        NUMERIC(14,2) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','COMPLETED')),
    reference_note      TEXT,                      -- free-text note user submits (never a payment/bank reference)
    sender_phone        VARCHAR(20),               -- deposit: Telebirr number the player sent money from
    payment_reference   VARCHAR(64),               -- deposit: Telebirr Transaction ID / Number
    reviewed_by         BIGINT REFERENCES users(id), -- admin who approved/rejected
    reviewed_at         TIMESTAMPTZ,
    game_room_id        BIGINT,                    -- set for GAME_ENTRY / PRIZE / GAME_REFUND
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_type ON transactions(type);

-- the same Transaction ID can only be submitted once (a rejected one may be re-submitted)
CREATE UNIQUE INDEX uq_transactions_deposit_reference ON transactions (UPPER(payment_reference))
    WHERE type = 'VIRTUAL_DEPOSIT' AND payment_reference IS NOT NULL AND status <> 'REJECTED';

-- ----------------------------------------------------------------------------
-- GAME ROOMS  (real bingo rooms / stake tiers)
-- ----------------------------------------------------------------------------
CREATE TABLE stake_tiers (
    id                  SERIAL PRIMARY KEY,
    entry_credits       NUMERIC(10,2) NOT NULL UNIQUE,
    commission_percent  NUMERIC(5,2) NOT NULL,      -- platform commission taken from virtual pot
    min_players         INT NOT NULL DEFAULT 2,
    max_players         INT NOT NULL DEFAULT 100
);

CREATE TABLE game_rooms (
    id                  BIGSERIAL PRIMARY KEY,
    room_code           VARCHAR(12) UNIQUE NOT NULL,
    stake_tier_id       INT NOT NULL REFERENCES stake_tiers(id),
    status              VARCHAR(20) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','COUNTDOWN','IN_PROGRESS','FINISHED','CANCELLED')),
    called_numbers      INT[] NOT NULL DEFAULT '{}',
    winner_pattern      VARCHAR(30),
    pot_total           NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    commission_taken    NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    started_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_game_rooms_status ON game_rooms(status);

-- ----------------------------------------------------------------------------
-- GAME ENTRIES  (real players seated in a real room, virtual credits staked)
-- ----------------------------------------------------------------------------
CREATE TABLE game_entries (
    id                  BIGSERIAL PRIMARY KEY,
    game_room_id        BIGINT NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
    user_id             BIGINT NOT NULL REFERENCES users(id),
    card_id             INT CHECK (card_id BETWEEN 1 AND 150),  -- number of the card (1-150) the player picked
    card_numbers        JSONB NOT NULL,             -- 5x5 bingo card assigned to this player
    marked_numbers      INT[] NOT NULL DEFAULT '{}',
    is_winner           BOOLEAN NOT NULL DEFAULT FALSE,
    prize_credits       NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    joined_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(game_room_id, user_id)
);

CREATE INDEX idx_game_entries_room ON game_entries(game_room_id);
CREATE INDEX idx_game_entries_user ON game_entries(user_id);

-- one card number can only be held by ONE player per room
CREATE UNIQUE INDEX uq_game_entries_room_card ON game_entries (game_room_id, card_id) WHERE card_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- AUDIT LOG  (every sensitive/admin action)
-- ----------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id                  BIGSERIAL PRIMARY KEY,
    actor_user_id       BIGINT REFERENCES users(id),   -- admin or system
    action              VARCHAR(64) NOT NULL,
    target_type         VARCHAR(32),                    -- 'user' | 'transaction' | 'game_room' | ...
    target_id           BIGINT,
    metadata            JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);

-- ----------------------------------------------------------------------------
-- ADMIN SETTINGS  (Telebirr account is informational/display-only; the bot
-- never initiates or automates real-money transfer against it)
-- ----------------------------------------------------------------------------
CREATE TABLE admin_settings (
    key                 VARCHAR(64) PRIMARY KEY,
    value               TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- seed default stake tiers (entry credits, commission %)
INSERT INTO stake_tiers (entry_credits, commission_percent) VALUES
    (10, 20), (20, 30), (30, 10), (50, 10), (70, 10), (100, 10);

-- seed informational Telebirr display fields (copy-only, not wired to any transfer logic)
INSERT INTO admin_settings (key, value) VALUES
    ('telebirr_account_name', 'KING BINGO ADMIN'),
    ('telebirr_account_phone', '0900000000');
