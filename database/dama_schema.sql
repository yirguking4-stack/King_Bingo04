-- ============================================================================
-- KING DAMA (Russian Checkers) — additive schema. Safe to run many times.
-- Touches NO existing table. Money uses the existing wallets/transactions tables
-- (types GAME_ENTRY / GAME_REFUND / PRIZE, reference_note = 'DAMA:<room_code>').
-- ============================================================================
CREATE TABLE IF NOT EXISTS dama_rooms (
    id               BIGSERIAL PRIMARY KEY,
    room_code        VARCHAR(10) UNIQUE NOT NULL,
    creator_id       BIGINT NOT NULL REFERENCES users(id),
    bet_amount       INTEGER NOT NULL DEFAULT 0 CHECK (bet_amount >= 0),
    status           VARCHAR(20) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','IN_PROGRESS','FINISHED','CANCELLED')),
    wait_deadline    TIMESTAMPTZ,
    state            JSONB,                       -- authoritative board, turn, chain, deadline
    pot_total        INTEGER NOT NULL DEFAULT 0,
    commission_taken INTEGER NOT NULL DEFAULT 0,
    prize            INTEGER NOT NULL DEFAULT 0,
    winner_user_id   BIGINT REFERENCES users(id),
    is_draw          BOOLEAN NOT NULL DEFAULT FALSE,
    end_reason       VARCHAR(30),
    settled          BOOLEAN NOT NULL DEFAULT FALSE,  -- settlement happened exactly once
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at       TIMESTAMPTZ,
    ended_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dama_rooms_status ON dama_rooms(status);

CREATE TABLE IF NOT EXISTS dama_players (
    id          BIGSERIAL PRIMARY KEY,
    room_id     BIGINT NOT NULL REFERENCES dama_rooms(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id),
    side        SMALLINT,                         -- 0 = white (moves first), 1 = black
    stake_paid  INTEGER NOT NULL DEFAULT 0,
    status      VARCHAR(12) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LEFT')),
    is_winner   BOOLEAN NOT NULL DEFAULT FALSE,
    prize       INTEGER NOT NULL DEFAULT 0,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_dama_players_user ON dama_players(user_id);

-- one row per accepted step (a multi-capture is several rows with the same move_no turn)
CREATE TABLE IF NOT EXISTS dama_moves (
    id         BIGSERIAL PRIMARY KEY,
    room_id    BIGINT NOT NULL REFERENCES dama_rooms(id) ON DELETE CASCADE,
    move_no    INT NOT NULL,
    user_id    BIGINT,
    side       SMALLINT NOT NULL,
    kind       VARCHAR(12) NOT NULL,              -- MOVE | TIMEOUT | RESIGN
    from_sq    SMALLINT,
    to_sq      SMALLINT,
    captured   SMALLINT,
    promoted   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dama_moves_room ON dama_moves(room_id);

CREATE TABLE IF NOT EXISTS dama_events (
    id         BIGSERIAL PRIMARY KEY,
    room_id    BIGINT,
    user_id    BIGINT,
    kind       VARCHAR(40) NOT NULL,
    detail     JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dama_events_created ON dama_events(created_at DESC);
