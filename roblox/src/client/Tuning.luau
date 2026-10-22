-- Physics and scoring constants, ported 1:1 from game.js (Endless mode).
-- The simulation runs in the web game's units (metres); World.S scales them to studs for drawing.
local Tuning = {
	G = 28, -- gravity (m/s^2)
	SLOPE = 0.27, -- visual tilt of the mountain (rad)
	FLIP_RATE = 8.5, -- rad/s
	SPIN_RATE = 10.5, -- rad/s
	ROLL_RATE = 8, -- sideflip rad/s
	X_LIMIT = 13, -- course half-width
	VIEW = 260, -- how far ahead the course is built
	COMBO_WINDOW = 3.0, -- seconds on the ground before a combo banks
	JUMP_POP = 11,
	MAX_CHARGE = 0.45,
	SPEED_K = 1.07,

	-- Harder than the web game: tighter landings and hazards that ramp up sooner.
	LAND_OK = 1.0, -- max rotation error (rad) you can ride away from (web: 1.35)
	LAND_PERFECT = 0.22, -- (web: 0.3)
	LAND_SKETCHY = 0.45, -- (web: 0.6)
	RAMP_UP = 900, -- metres until the course is at full difficulty (web: 1600)
	EXTRA_HAZARDS = 1.5, -- more scattered rocks between features
}

function Tuning.baseSpeed(d: number): number
	return math.min(70, 24 + d * 0.013) * Tuning.SPEED_K
end

function Tuning.popFromCharge(t: number): number
	return 7.5 + 6 * math.clamp(t / Tuning.MAX_CHARGE, 0, 1)
end

-- trampoline vertical speed for the n-th bounce in a row
function Tuning.bounceVy(n: number): number
	return 20 + 3.5 * math.min(n, 3)
end

return Tuning
