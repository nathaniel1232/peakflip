-- Values the client and the server both need.
return {
	SAVE_STORE = "PeakFlipSave_v1",
	BOARD_ALL_TIME = "PeakFlipBest_v1",
	BOARD_DAILY_PREFIX = "PeakFlipDaily_v1_", -- + UTC date, e.g. PeakFlipDaily_v1_2026-10-21
	BOARD_SIZE = 10,

	-- Server-side sanity limits for a reported run. Generous on purpose: a long combo of big
	-- flips can earn a lot quickly, and an honest player should never hit these.
	MAX_SCORE_PER_SECOND = 15000,
	MAX_SCORE_FLAT = 25000,
	MAX_COINS_PER_SECOND = 8,

	COIN_BONUS_DIVISOR = 250, -- end-of-run bonus coins = floor(score / 250) (the web game uses 400)
	XP_SCORE_DIVISOR = 100, -- XP per run = score / 100 + distance / 20
	XP_DIST_DIVISOR = 20,

	MAX_REVIVES = 2, -- per run; revives are bought with Robux (the "revive" product) or free once a run with VIP

	-- Robux: create a game pass / developer product in the Creator Dashboard, paste its id here.
	-- Anything left at 0 is hidden from players (and shown as a reminder in Studio).
	PASS_IDS = { doubleCoins = 0, doubleXp = 0, vip = 0, goldGear = 0 },
	PRODUCT_IDS = { revive = 0, coins1 = 0, coins2 = 0, coins3 = 0 },

	-- Background music. The game's own track is uploaded by tools/upload_assets.py; to use a different
	-- one, paste its audio id here (e.g. "rbxassetid://1234567890").
	MUSIC_ID = "",

	-- Where the shared lobby sits. The ski runs are built on each player's own client near the origin.
	LOBBY_ORIGIN = Vector3.new(0, 0, 4000),
	RIDER_HOLD = Vector3.new(0, 1500, 4000), -- where a rider's real character waits during a run
}
