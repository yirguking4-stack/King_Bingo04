-- ============================================================================
-- KING LUDO — additive schema. Safe to run many times (IF NOT EXISTS).
-- Touches NO existing table. Money uses the existing wallets/transactions tables
-- (types GAME_ENTRY / GAME_REFUND / PRIZE, reference_note = 'LUDO:<room_code>').
-- ============================================================================

CREATE TABLE IF NOT EXISTS ludo_rooms (
    id               BIGSERIAL PRIMARY KEY,
    room_code        VARCHAR(10) UNIQUE NOT NULL,
    creator_id       BIGINT NOT NULL REFERENCES users(id),
    capacity         SMALLINT NOT NULL CHECK (capacity IN (2,4)),
    bet_amount       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (bet_amount >= 0),
    crowns           SMALLINT NOT NULL DEFAULT 4 CHECK (crowns IN (1,2,4)),   -- tokens that must reach the centre to win
    status           VARCHAR(20) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','IN_PROGRESS','FINISHED','CANCELLED')),
    wait_deadline    TIMESTAMPTZ,
    state            JSONB,                       -- authoritative game state (tokens, turn, phase, deadline, missed counters)
    pot_total        NUMERIC(14,2) NOT NULL DEFAULT 0,
    commission_taken NUMERIC(14,2) NOT NULL DEFAULT 0,
    prize            NUMERIC(14,2) NOT NULL DEFAULT 0,
    winner_user_id   BIGINT REFERENCES users(id),
    end_reason       VARCHAR(30),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at       TIMESTAMPTZ,
    ended_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ludo_rooms_status ON ludo_rooms(status);

CREATE TABLE IF NOT EXISTS ludo_players (
    id          BIGSERIAL PRIMARY KEY,
    room_id     BIGINT NOT NULL REFERENCES ludo_rooms(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id),
    seat        SMALLINT,
    stake_paid  NUMERIC(14,2) NOT NULL DEFAULT 0,
    status      VARCHAR(12) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REMOVED','LEFT')),
    is_winner   BOOLEAN NOT NULL DEFAULT FALSE,
    prize       NUMERIC(14,2) NOT NULL DEFAULT 0,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ludo_players_user ON ludo_players(user_id);

-- dice rolls + token moves (turn history)
CREATE TABLE IF NOT EXISTS ludo_turns (
    id         BIGSERIAL PRIMARY KEY,
    room_id    BIGINT NOT NULL REFERENCES ludo_rooms(id) ON DELETE CASCADE,
    turn_no    INT NOT NULL,
    user_id    BIGINT,
    seat       SMALLINT NOT NULL,
    kind       VARCHAR(12) NOT NULL,             -- ROLL | MOVE | PASS | REMOVED
    dice       SMALLINT,
    auto       BOOLEAN NOT NULL DEFAULT FALSE,
    token_idx  SMALLINT,
    from_pos   SMALLINT,
    to_pos     SMALLINT,
    captured   JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ludo_turns_room ON ludo_turns(room_id);

-- errors and suspicious activity (shown to admins)
CREATE TABLE IF NOT EXISTS ludo_events (
    id         BIGSERIAL PRIMARY KEY,
    room_id    BIGINT,
    user_id    BIGINT,
    kind       VARCHAR(40) NOT NULL,
    detail     JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ludo_events_created ON ludo_events(created_at DESC);
